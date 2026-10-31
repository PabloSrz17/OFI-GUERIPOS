const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. Debe ir antes de cargar los módulos.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');

const db = require('../src/db/connection');
const notas = require('../src/repositories/notas.repo');
const choferes = require('../src/repositories/choferes.repo');
const importador = require('../src/integraciones/importador');

const almacen = choferes.listarActivos().find((c) => c.almacen);
const chofer = db.prepare("INSERT INTO choferes (nombre) VALUES ('Prueba')").run().lastInsertRowid;
const camion = db.prepare("INSERT INTO camiones (nombre) VALUES ('Prueba')").run().lastInsertRowid;
let folio = 0;
const nueva = () => importador.registrar({
  cliente: { nombre: 'CLIENTE' },
  nota: { origen: 'sicar', folio: `A${folio += 1}`, material: 'GRAVA', cantidad: 1, unidad: 'm³', direccion: 'Centro' },
});
const datos = (nota, cambios) => ({
  folio: nota.folio, cliente_id: nota.cliente_id, cantidad: 1, unidad: 'm³', material: 'GRAVA', detalle: null,
  total: null, direccion: 'Centro', zona: null, chofer_id: null, camion_id: null, ...cambios,
});

test('ALMACÉN sale primero en la lista de choferes', () => {
  assert.equal(almacen.nombre, 'ALMACÉN');
  assert.equal(choferes.listarActivos()[0].id, almacen.id);
});

test('ALMACÉN no pide camión, quita el que tenía y no pasa por En Ruta', () => {
  const { id } = nueva();
  notas.asignar(id, 'camion', camion);
  const asignada = notas.asignar(id, 'chofer', almacen.id);
  assert.equal(asignada.es_almacen, 1);
  assert.equal(asignada.camion_id, null);
  assert.equal(notas.resumen().sin_chofer, 0);

  notas.cambiarEstado(id, 'cargando');
  assert.throws(() => notas.cambiarEstado(id, 'en_ruta'), { status: 409 });
  assert.throws(() => notas.asignar(id, 'camion', camion), { status: 409 });
  assert.equal(notas.cambiarEstado(id, 'entregado').nota.estado, 'entregado');
  assert.equal(notas.regresar(id).nota.estado, 'cargando');
});

test('una nota normal sigue pidiendo chofer y camión', () => {
  const { id } = nueva();
  assert.throws(() => notas.cambiarEstado(id, 'cargando'), { status: 409 });
  notas.asignar(id, 'chofer', chofer);
  assert.equal(notas.resumen().sin_chofer, 1);
  assert.throws(() => notas.cambiarEstado(id, 'cargando'), { status: 409 });
  notas.asignar(id, 'camion', camion);
  notas.cambiarEstado(id, 'cargando');
  assert.throws(() => notas.cambiarEstado(id, 'entregado'), { status: 409 });
  assert.equal(notas.cambiarEstado(id, 'en_ruta').nota.estado, 'en_ruta');
  db.prepare('DELETE FROM notas WHERE id = ?').run(id);
});

test('de ALMACÉN a chofer normal en Cargando: pide camión antes de salir', () => {
  const { id } = nueva();
  notas.asignar(id, 'chofer', almacen.id);
  notas.cambiarEstado(id, 'cargando');
  notas.asignar(id, 'chofer', chofer);
  assert.throws(() => notas.cambiarEstado(id, 'en_ruta'), { status: 409 });
  notas.asignar(id, 'camion', camion);
  assert.equal(notas.cambiarEstado(id, 'en_ruta').nota.estado, 'en_ruta');
});

test('al editar, ALMACÉN vacía el camión y cuenta como asignada', () => {
  const nota = nueva();
  notas.asignar(nota.id, 'chofer', chofer);
  notas.asignar(nota.id, 'camion', camion);
  notas.cambiarEstado(nota.id, 'cargando');
  const editada = notas.editar(nota.id, datos(nota, { chofer_id: almacen.id, camion_id: camion }));
  assert.equal(editada.camion_id, null);
  assert.equal(editada.es_almacen, 1);
  assert.throws(() => notas.editar(nota.id, datos(nota, { chofer_id: chofer })), { status: 409 });
});
