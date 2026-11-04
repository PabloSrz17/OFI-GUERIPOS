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
  assert.throws(() => notas.ponerViaje(id, camion, 6), /del 1 al 5/);
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
