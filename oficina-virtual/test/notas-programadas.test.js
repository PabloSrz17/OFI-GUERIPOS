const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. Debe ir antes de cargar los módulos.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');

const notas = require('../src/repositories/notas.repo');
const importador = require('../src/integraciones/importador');

let folio = 0;
const nueva = () => importador.registrar({
  cliente: { nombre: 'CLIENTE' },
  nota: { origen: 'sicar', folio: `P${folio += 1}`, material: 'GRAVA', cantidad: 1, unidad: 'm³', direccion: 'Centro' },
});
const dia = (mas) => {
  const d = new Date();
  d.setDate(d.getDate() + mas);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('una nota programada sale del tablero y de los pendientes hasta su fecha', () => {
  const { id } = nueva();
  const antes = notas.resumen().pendiente;
  notas.programar(id, dia(3));
  assert.ok(!notas.listarTablero().some((n) => n.id === id));
  assert.equal(notas.resumen().pendiente, antes - 1);
  assert.deepEqual(notas.listarProgramadas().map((n) => n.id), [id]);
  notas.programar(id, null); // regresar a hoy
  assert.ok(notas.listarTablero().some((n) => n.id === id));
  assert.equal(notas.listarProgramadas().length, 0);
});

test('sólo se programa una nota pendiente y para mañana en adelante', () => {
  const { id } = nueva();
  assert.throws(() => notas.programar(id, dia(0)), /mañana en adelante/);
  assert.throws(() => notas.programar(id, 'mañana'), /Fecha inválida/);
  notas.asignar(id, 'chofer', require('../src/repositories/choferes.repo').listarActivos().find((c) => c.almacen).id);
  notas.cambiarEstado(id, 'cargando');
  assert.throws(() => notas.programar(id, dia(2)), /pendiente/);
});

test('corcho: soltar en un viaje guarda camión y número de viaje; sin unidad lo borra', () => {
  const { id } = nueva();
  const camion = require('../src/db/connection').prepare("INSERT INTO camiones (nombre) VALUES ('Nissan Prueba')").run().lastInsertRowid;
  let n = notas.ponerViaje(id, camion, 2);
  assert.equal(n.camion_id, camion);
  assert.equal(n.viaje, 2);
  assert.equal(notas.ponerViaje(id, camion, 7).viaje, 7); // hasta el 7mo viaje
  assert.throws(() => notas.ponerViaje(id, camion, 8), /del 1 al 7/);
  n = notas.ponerViaje(id, null, null);
  assert.equal(n.camion_id, null);
  assert.equal(n.viaje, null);
});

test('"Él avisa": sale del tablero sin fecha fija y no dispara el aviso de mañana', () => {
  const { id } = nueva();
  const n = notas.programar(id, 'avisa');
  assert.equal(n.programada_para, notas.EL_AVISA);
  assert.ok(!notas.listarTablero().some((x) => x.id === id));
  assert.ok(notas.listarProgramadas().some((x) => x.id === id));
  assert.ok(!notas.foliosParaManana().includes(n.folio));
  notas.programar(id, null);
});

test('cierre de jornada: el Reparto de mañana pasa al del día con su camión y viaje', () => {
  const { id } = nueva();
  const otra = nueva();
  const camion = require('../src/db/connection').prepare("INSERT INTO camiones (nombre) VALUES ('Nissan Cierre')").run().lastInsertRowid;
  notas.programar(id, dia(1));
  notas.ponerViaje(id, camion, 3);
  notas.programar(otra.id, dia(4));
  const r = notas.cerrarJornada();
  assert.ok(r.deManana >= 1);
  const n = notas.listarTablero().find((x) => x.id === id);
  assert.ok(n, 'debe verse hoy');
  assert.equal(n.camion_id, camion);
  assert.equal(n.viaje, 3);
  assert.ok(notas.listarProgramadas().some((x) => x.id === otra.id)); // la de otro día se queda
  notas.programar(otra.id, null);
});

test('Reprogramar con fecha: sólo ésas avisan un día antes (burbuja y celular, una vez por nota y día)', async () => {
  const avisoFecha = require('../src/integraciones/aviso-fecha');
  const { config } = require('../src/integraciones/avisos-celular');
  const conFecha = nueva();
  const manana = nueva();
  const lejos = nueva();
  notas.programar(conFecha.id, dia(1), true); // fecha del cliente que cae mañana
  notas.programar(manana.id, dia(1)); // botón "Mañana": no avisa
  notas.programar(lejos.id, dia(5), true); // todavía falta
  assert.deepEqual(notas.conFechaManana().map((n) => n.folio), [conFecha.folio]);
  assert.equal(notas.programar(lejos.id, 'avisa', true).con_fecha, 0); // "Cliente avisa" no lleva fecha

  const enviados = [];
  config.ntfy = 'https://ntfy.example/prueba';
  const enviar = async (url, opciones) => { enviados.push(opciones.body); };
  const ocho = new Date(); ocho.setHours(9, 0, 0, 0);
  assert.deepEqual(await avisoFecha.revisar(ocho, enviar), [conFecha.folio]);
  assert.equal(await avisoFecha.revisar(ocho, enviar), null); // ya avisada hoy
  assert.equal(enviados.length, 1);
  assert.match(enviados[0], new RegExp(conFecha.folio));
  config.ntfy = null;
});

test('"No se entregó" desde el historial: regresa a Pendientes hoy o programada, sin chofer, camión ni viaje', () => {
  const db = require('../src/db/connection');
  const entregada = () => {
    const { id } = nueva();
    db.prepare(`UPDATE notas SET estado = 'entregado', viaje = 2, archivada_en = datetime('now', 'localtime', '-1 day'),
      actualizado_en = datetime('now', 'localtime', '-1 day') WHERE id = ?`).run(id);
    return id;
  };
  const hoy = entregada();
  assert.ok(notas.historialGeneral().some((n) => n.id === hoy));
  assert.throws(() => notas.devolver(hoy, dia(0)), /mañana en adelante/);
  const { nota, anterior } = notas.devolver(hoy, null);
  assert.equal(anterior, 'entregado');
  assert.equal(nota.estado, 'pendiente');
  assert.equal(nota.viaje, null);
  assert.equal(nota.chofer_id, null);
  assert.equal(nota.archivada_en, null);
  assert.ok(notas.listarTablero().some((n) => n.id === hoy));
  assert.ok(!notas.historialGeneral().some((n) => n.id === hoy));
  assert.throws(() => notas.devolver(hoy, null), /no está entregada/);

  const otroDia = entregada();
  notas.devolver(otroDia, dia(3));
  assert.ok(!notas.listarTablero().some((n) => n.id === otroDia));
  assert.equal(notas.listarProgramadas().find((n) => n.id === otroDia).programada_para, dia(3));
});

test('el domingo no hay reparto: una fecha en domingo pasa al lunes', () => {
  const { id } = nueva();
  const d = new Date();
  d.setDate(d.getDate() + 2);
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1); // el próximo domingo (de pasado mañana en adelante)
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const domingo = iso(d);
  d.setDate(d.getDate() + 1);
  assert.equal(notas.programar(id, domingo).programada_para, iso(d));
  assert.equal(notas.programar(id, 'avisa').programada_para, notas.EL_AVISA); // "Él avisa" no se toca
});

test('el post-it se guarda, sigue al mover la nota y vacío se borra', () => {
  const { id } = nueva();
  assert.equal(notas.ponerPostit(id, 'Llamar antes de llegar').postit, 'Llamar antes de llegar');
  notas.programar(id, dia(3));
  assert.equal(notas.obtener(id).postit, 'Llamar antes de llegar');
  assert.equal(notas.ponerPostit(id, '').postit, null);
});

test('entrega pasada: queda entregada con esa fecha, chofer, camión y viaje, y no cuenta como de hoy', () => {
  const db = require('../src/db/connection');
  const { id } = nueva();
  const camion = db.prepare("INSERT INTO camiones (nombre) VALUES ('Nissan Ayer')").run().lastInsertRowid;
  const chofer = db.prepare("INSERT INTO choferes (nombre) VALUES ('CHOFER AYER')").run().lastInsertRowid;
  const antes = notas.resumen().entregado_hoy;
  assert.throws(() => notas.entregarAntes(id, { fecha: dia(0), chofer_id: chofer, camion_id: camion }), /ayer para atrás/);
  assert.throws(() => notas.entregarAntes(id, { fecha: dia(-1), chofer_id: chofer }), /camión/);
  const { nota } = notas.entregarAntes(id, { fecha: dia(-1), chofer_id: chofer, camion_id: camion, viaje: 2 });
  assert.equal(nota.estado, 'entregado');
  assert.equal(nota.actualizado_en, `${dia(-1)} 10:00:00`);
  assert.equal(nota.viaje, 2);
  assert.equal(notas.resumen().entregado_hoy, antes);
  assert.ok(notas.historialGeneral().some((n) => n.id === id));
  assert.equal(db.prepare("SELECT fecha FROM historial_estados WHERE nota_id = ? AND estado_nuevo = 'entregado'").get(id).fecha, `${dia(-1)} 10:00:00`);
  assert.throws(() => notas.entregarAntes(id, { fecha: dia(-1), chofer_id: chofer, camion_id: camion }), /ya está entregada/);
});
