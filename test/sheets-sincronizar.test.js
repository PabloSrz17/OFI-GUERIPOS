const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

// Base de datos de prueba: nunca la real; y la hoja es una falsa, en memoria.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');
process.env.SHEETS_URL = 'https://hoja.invalid/exec';
process.env.SHEETS_TOKEN = 'TOKEN-PRUEBA';

// ---- El script real de Google, corriendo sobre una pestaña en memoria ----
function hojaFalsa() {
  const filas = [];
  const fila = (r) => { while (filas.length < r) filas.push(Array(14).fill('')); return filas[r - 1]; };
  const hoja = {
    filas,
    getLastRow: () => { for (let i = filas.length; i > 0; i--) if (filas[i - 1].some(Boolean)) return i; return 0; },
    insertRowBefore: (r) => filas.splice(r - 1, 0, Array(14).fill('')),
    getRange: (r, c, nr = 1, nc = 1) => {
      const rango = {
        getDisplayValues: () => Array.from({ length: nr }, (_, i) => fila(r + i).slice(c - 1, c - 1 + nc)),
        setValues: (v) => { v.forEach((f, i) => f.forEach((x, j) => { fila(r + i)[c - 1 + j] = x; })); return rango; },
        setValue: (x) => { fila(r)[c - 1] = x; return rango; },
        clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) fila(r + i)[c - 1 + j] = ''; return rango; },
        setBackground: () => rango, setFontColor: () => rango, setFontWeight: () => rango, setNumberFormat: () => rango,
      };
      return rango;
    },
  };
  return hoja;
}

// cualquierMes: la misma pestaña sirve para cualquier fecha, para pruebas que corren "hoy".
function scriptDeGoogle({ cualquierMes = false } = {}) {
  const pestanas = { 'OCTUBRE 26': hojaFalsa() };
  pestanas['OCTUBRE 26'].getRange(3, 1, 1, 4).setValues([['CHOFER', 'NOTA', 'CLIENTE', 'MATERIAL']]);
  const contexto = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => (cualquierMes ? pestanas['OCTUBRE 26'] : pestanas[n] ?? null), getSheets: () => [] }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (texto) => ({ setMimeType: () => texto }) },
  });
  const codigo = fs.readFileSync(path.join(__dirname, '../scripts/google-sheets/Codigo.gs'), 'utf8').replace('PEGA_AQUI_EL_SHEETS_TOKEN', 'TOKEN-PRUEBA');
  vm.runInContext(codigo, contexto);
  return {
    hoja: pestanas['OCTUBRE 26'],
    post: (cuerpo) => JSON.parse(contexto.doPost({ postData: { contents: JSON.stringify(cuerpo) } })),
  };
}

const renglones = (hoja) => hoja.filas.filter((f) => f[1] && f[1] !== 'NOTA').map((f) => f.slice(0, 5).join('|'));
const entrega = (nota, cliente = 'JUAN') => ({ fecha: '2026-10-30', chofer: 'SOSA', nota, cliente, cemento: ['8 MAYA'], otros: ['1M POLVO'] });

test('el script: anota, no duplica, actualiza y borra sólo su renglón', () => {
  const { hoja, post } = scriptDeGoogle();
  const t = 'TOKEN-PRUEBA';
  assert.equal(post({ token: 'otro', accion: 'borrar', fecha: '2026-10-30', nota: 'A1' }).ok, false);

  post({ token: t, fila: entrega('A1') });
  post({ token: t, fila: entrega('A2') });
  post({ token: t, fila: entrega('A1') }); // reintento tras una falla
  assert.equal(renglones(hoja).length, 2);

  // Un renglón escrito a mano con otro folio no se toca.
  const aMano = hoja.getLastRow() + 1;
  hoja.getRange(aMano, 1, 1, 3).setValues([['CHUY', 'A10', 'A MANO']]);

  assert.equal(post({ token: t, accion: 'actualizar', fecha: '2026-10-30', nota: 'A1', nuevo: entrega('A1B', 'PEDRO') }).encontrado, true);
  assert.ok(renglones(hoja).some((r) => r.startsWith('SOSA|A1B|PEDRO')));
  assert.ok(!renglones(hoja).some((r) => r.split('|')[1] === 'A1'));

  assert.equal(post({ token: t, accion: 'borrar', fecha: '2026-10-30', nota: 'A1B' }).encontrado, true);
  assert.equal(renglones(hoja).length, 2); // quedan A2 y A10
  assert.ok(renglones(hoja).some((r) => r.split('|')[1] === 'A10'));

  assert.deepEqual(post({ token: t, accion: 'borrar', fecha: '2026-10-30', nota: 'NOEXISTE' }), { ok: true, encontrado: false });
  assert.deepEqual(post({ token: t, accion: 'borrar', fecha: '2026-11-30', nota: 'A2' }), { ok: true, encontrado: false }); // sin pestaña
  assert.equal(post({ token: t, accion: 'otra', fecha: '2026-10-30', nota: 'A2' }).ok, false);

  post({ token: t, fila: entrega('A3') }); // reutiliza el espacio libre: no agrega renglones de más
  assert.equal(renglones(hoja).length, 3);
});

// ---- El servidor, hablándole al mismo script ----
test('el panel: cancelar, regresar, editar y ALMACÉN se reflejan en la hoja', async () => {
  const { hoja, post } = scriptDeGoogle({ cualquierMes: true });
  let falla = false;
  global.fetch = async (_url, { body }) => {
    if (falla) throw new Error('sin internet');
    return { ok: true, status: 200, text: async () => JSON.stringify(post(JSON.parse(body))) };
  };
  const espera = () => new Promise((r) => setTimeout(r, 100));

  const db = require('../src/db/connection');
  const bus = require('../src/events/bus');
  const notas = require('../src/repositories/notas.repo');
  const importador = require('../src/integraciones/importador');
  const registro = require('../src/integraciones/sheets/registro');
  const choferes = require('../src/repositories/choferes.repo');
  registro.iniciar();

  const chofer = db.prepare("INSERT INTO choferes (nombre) VALUES ('Moises Sosa')").run().lastInsertRowid;
  const camion = db.prepare("INSERT INTO camiones (nombre) VALUES ('Ram')").run().lastInsertRowid;
  const almacen = choferes.listarActivos().find((c) => c.almacen).id;
  const aEntregada = async (folio) => {
    const { id } = importador.registrar({ cliente: { nombre: 'JUAN' }, nota: { origen: 'sicar', folio, material: 'GRAVA', cantidad: 1, unidad: 'm³', direccion: 'Centro' } });
    notas.asignar(id, 'chofer', chofer);
    notas.asignar(id, 'camion', camion);
    notas.cambiarEstado(id, 'cargando');
    notas.cambiarEstado(id, 'en_ruta');
    const hecho = notas.cambiarEstado(id, 'entregado');
    db.prepare("UPDATE notas SET actualizado_en = '2026-10-30 12:00:00' WHERE id = ?").run(id); // la pestaña de prueba
    bus.emit('nota:estado', { ...hecho, nota: notas.obtener(id), retroceso: false });
    await espera();
    return id;
  };
  const folios = () => renglones(hoja).map((r) => r.split('|')[1]).sort();
  const editar = (id, cambios) => {
    const n = notas.obtener(id);
    const datos = { folio: n.folio, cliente_id: n.cliente_id, cantidad: n.cantidad, unidad: n.unidad, material: n.material, detalle: n.detalle, total: n.total, direccion: n.direccion, zona: n.zona, chofer_id: n.chofer_id, camion_id: n.camion_id, ...cambios };
    bus.emit('nota:editada', notas.editar(id, datos));
  };

  // Entregar escribe; regresar borra; volver a entregar escribe otra vez.
  const a = await aEntregada('S1');
  assert.deepEqual(folios(), ['S1']);
  bus.emit('nota:estado', { ...notas.regresar(a), retroceso: true });
  await espera();
  assert.deepEqual(folios(), []);
  bus.emit('nota:estado', { ...notas.cambiarEstado(a, 'entregado'), retroceso: false });
  await espera();
  assert.equal(notas.obtener(a).sheets, 'registrado');

  // Editar actualiza, aunque cambie el folio; y se puede editar dos veces.
  db.prepare("UPDATE sheets_registros SET fecha_hoja = '2026-10-30' WHERE nota_id = ?").run(a);
  editar(a, { folio: 'S1B' });
  await espera();
  editar(a, { material: 'ARENA' });
  await espera();
  assert.deepEqual(folios(), ['S1B']);

  // Cancelar borra.
  const b = await aEntregada('S2');
  bus.emit('nota:eliminada', notas.eliminar(b));
  await espera();
  assert.deepEqual(folios(), ['S1B']);

  // ALMACÉN sale de la hoja de reparto.
  const c = await aEntregada('S3');
  editar(c, { chofer_id: almacen, camion_id: null });
  await espera();
  assert.deepEqual(folios(), ['S1B']);

  // Entregada en ALMACÉN desde el inicio: nunca llega a la hoja, pero queda en el historial.
  const llamadasAntes = folios().length;
  const { id: alm } = importador.registrar({ cliente: { nombre: 'JUAN' }, nota: { origen: 'sicar', folio: 'S3A', material: 'GRAVA', cantidad: 1, unidad: 'm³', direccion: 'Centro' } });
  notas.asignar(alm, 'chofer', almacen);
  notas.cambiarEstado(alm, 'cargando');
  bus.emit('nota:estado', { ...notas.cambiarEstado(alm, 'entregado'), retroceso: false });
  await espera();
  assert.equal(folios().length, llamadasAntes);
  assert.equal(notas.obtener(alm).sheets, null);
  notas.cerrarJornada();
  assert.ok(notas.historialGeneral().some((n) => n.folio === 'S3A'));

  // Ya tenía renglón, se regresó sin borrarlo (nota vieja) y eligen ALMACÉN en la tarjeta: sale de la hoja.
  const vieja = await aEntregada('S3B');
  assert.ok(folios().includes('S3B'));
  db.prepare("UPDATE notas SET estado = 'cargando' WHERE id = ?").run(vieja);
  bus.emit('nota:asignada', notas.asignar(vieja, 'chofer', almacen));
  await espera();
  assert.ok(!folios().includes('S3B'));
  assert.equal(notas.obtener(vieja).sheets, null);

  // Lo mismo si la nota vieja se entrega en ALMACÉN con su renglón todavía puesto.
  const otra = await aEntregada('S3C');
  db.prepare("UPDATE notas SET estado = 'cargando', chofer_id = ?, camion_id = NULL WHERE id = ?").run(almacen, otra);
  bus.emit('nota:estado', { ...notas.cambiarEstado(otra, 'entregado'), retroceso: false });
  await espera();
  assert.ok(!folios().includes('S3C'));

  // Sin internet el cambio espera, en orden, y no se pierde.
  const d = await aEntregada('S4');
  falla = true;
  bus.emit('nota:eliminada', notas.eliminar(d));
  await espera();
  assert.deepEqual(folios(), ['S1B', 'S4']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sheets_cambios').get().n, 1);
  falla = false;
  await registro.aplicarCambios();
  assert.deepEqual(folios(), ['S1B']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sheets_cambios').get().n, 0);

  // Una nota sin entregar nunca toca la hoja.
  const { id: e } = importador.registrar({ cliente: { nombre: 'JUAN' }, nota: { origen: 'sicar', folio: 'S5', material: 'GRAVA', cantidad: 1, unidad: 'm³', direccion: 'Centro' } });
  bus.emit('nota:eliminada', notas.eliminar(e));
  await espera();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sheets_cambios').get().n, 0);
});

test('un script viejo no duplica: los cambios no llevan "fila" y se quedan esperando', async () => {
  const registro = require('../src/integraciones/sheets/registro');
  const db = require('../src/db/connection');
  db.prepare(`INSERT INTO sheets_cambios (accion, fecha, folio, nuevo) VALUES ('actualizar', '2026-10-30', 'V1', '{"fecha":"2026-10-30"}')`).run();
  let recibido = null;
  global.fetch = async (_url, { body }) => {
    recibido = JSON.parse(body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: false, error: 'fila sin fecha' }) }; // lo que responde el viejo
  };
  await registro.aplicarCambios();
  assert.equal(recibido.fila, undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sheets_cambios').get().n, 1);
  db.prepare('DELETE FROM sheets_cambios').run();
});
