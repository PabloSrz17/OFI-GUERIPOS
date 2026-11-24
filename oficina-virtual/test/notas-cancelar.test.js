const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. Debe ir antes de cargar los módulos.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');

const db = require('../src/db/connection');
const notas = require('../src/repositories/notas.repo');
const importador = require('../src/integraciones/importador');

test('cancelar borra la nota y el robot no la vuelve a traer de Pulpos', () => {
  const nota = importador.registrar({
    cliente: { nombre: 'CLIENTE' },
    nota: { origen: 'pulpos', folio: '777', material: 'Grava', cantidad: 1, direccion: 'Centro' },
  });
  notas.eliminar(nota.id);
  assert.equal(notas.obtenerSiExiste(nota.id), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM historial_estados WHERE nota_id = ?').get(nota.id).n, 0);
  assert.equal(importador.yaVisto('pulpos', '777'), true);
});

test('la cantidad de una nota acepta texto libre', () => {
  const { materialesDeNota } = require('../src/integraciones/sheets/abreviar');
  const guardar = (folio, cantidad, unidad) => importador.registrar({
    cliente: { nombre: 'CLIENTE' },
    nota: { origen: 'sicar', folio, material: 'GRAVA', cantidad, unidad, direccion: 'Centro' },
  });
  const media = guardar('L1', '1/2', 'm³');
  assert.equal(media.cantidad, '1/2');
  assert.deepEqual(materialesDeNota(media).otros, ['1/2M GRAVA']);
  const mixta = guardar('L2', '1 m³ /2 M3', '');
  assert.deepEqual(materialesDeNota(mixta).otros, ['1 m³ /2 M3 GRAVA']);
  assert.equal(guardar('L3', '7', 'm³').cantidad, 7);
});

test('editar cambia cualquier dato, también en una entregada; el folio no se repite', () => {
  const nota = importador.registrar({
    cliente: { nombre: 'CLIENTE' },
    nota: { origen: 'pulpos', folio: 'E1', material: 'Grava', cantidad: 1, direccion: 'Centro' },
  });
  const datos = {
    folio: 'E2', cliente_id: nota.cliente_id, cantidad: '1/2', unidad: 'm³', material: 'ARENA', detalle: null,
    total: 500, direccion: 'Calle 8', zona: null, chofer_id: null, camion_id: null,
  };
  const editada = notas.editar(nota.id, datos);
  assert.equal(editada.cantidad, '1/2');
  assert.equal(editada.folio, 'E2');
  assert.equal(editada.total, 500);

  db.prepare("UPDATE notas SET estado = 'entregado' WHERE id = ?").run(nota.id);
  assert.throws(() => notas.editar(nota.id, datos), { status: 409 }); // ya pasó de Pendiente: pide chofer y camión
  const chofer = db.prepare('SELECT id FROM choferes LIMIT 1').get()?.id ?? db.prepare("INSERT INTO choferes (nombre) VALUES ('X')").run().lastInsertRowid;
  const camion = db.prepare('SELECT id FROM camiones LIMIT 1').get()?.id ?? db.prepare("INSERT INTO camiones (nombre) VALUES ('X')").run().lastInsertRowid;
  assert.equal(notas.editar(nota.id, { ...datos, chofer_id: chofer, camion_id: camion, material: 'POLVO' }).material, 'POLVO');

  const otra = importador.registrar({
    cliente: { nombre: 'CLIENTE' },
    nota: { origen: 'pulpos', folio: 'E3', material: 'Grava', cantidad: 1, direccion: 'Centro' },
  });
  assert.throws(() => notas.editar(otra.id, datos), { status: 409 });
});

test('Darío aparece como chofer', () => {
  assert.ok(db.prepare(`SELECT 1 FROM choferes WHERE nombre = 'Darío' AND activo = 1`).get());
});

test('cancelar una nota que no existe da 404', () => {
  assert.throws(() => notas.eliminar(99999), { status: 404 });
});
