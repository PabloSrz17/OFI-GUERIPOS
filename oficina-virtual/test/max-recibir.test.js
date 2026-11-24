const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. Debe ir antes de cargar los módulos.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');
delete process.env.ANTHROPIC_API_KEY;

const ordenes = require('../src/integraciones/octavio/ordenes');

const COMPRA = {
  externo: '2320', folio: '3020', proveedor: 'ALESA', fecha: '2026-11-06 09:06:55',
  renglones: [{ cantidad: '400', unidad: 'pz', material: 'BLOCK DE 15' }, { cantidad: '20', unidad: 'pz', material: 'CEMENTO MAYA 25 KG' }],
};

test('Max: la compra de SICAR entra una sola vez a Órdenes de Compra Almacén', () => {
  assert.equal(ordenes.importarDeSicar([COMPRA]), 1);
  assert.equal(ordenes.importarDeSicar([COMPRA]), 0);
  const o = ordenes.listar().find((x) => x.externo === '2320');
  assert.equal(o.sucursal, 'Almacén');
  assert.equal(o.estado, 'aprobada');
  assert.equal(o.proveedor, 'ALESA');
  assert.equal(o.solicitante, 'SICAR');
  assert.equal(o.folio, '3020'); // el folio de SICAR, no OC-n
  assert.deepEqual(o.avance.map((a) => a.pendiente), [400, 20]);
});

test('Max: entrega parcial pide folio, crea la entrada y deja lo que falta; la completa pasa a Surtidas', () => {
  const o = ordenes.listar().find((x) => x.externo === '2320');
  assert.throws(() => ordenes.recibirOrden(o.id, { folio: '', cantidades: ['200', '0'] }), /folio/);
  assert.throws(() => ordenes.recibirOrden(o.id, { folio: 'F1', cantidades: ['500', '0'] }), /sólo faltan 400/);
  assert.throws(() => ordenes.recibirOrden(o.id, { folio: 'F1', cantidades: ['0', '0'] }), /al menos un material/);

  const r1 = ordenes.recibirOrden(o.id, { folio: 'f-98961', cantidades: ['200', ''] });
  assert.equal(r1.completa, false);
  assert.equal(r1.orden.estado, 'aprobada');
  assert.deepEqual(r1.orden.avance.map((a) => [a.recibido, a.pendiente]), [[200, 200], [0, 20]]);
  const entrada = ordenes.entradas()[0];
  assert.equal(entrada.folio, 'F-98961');
  assert.equal(entrada.proveedor, 'ALESA');
  assert.equal(entrada.sucursal, 'Almacén');
  assert.equal(entrada.orden_id, o.id);
  assert.equal(entrada.nota, `${o.folio} · parcial`);
  assert.deepEqual(entrada.renglones, [{ cantidad: '200', unidad: 'pz', material: 'BLOCK DE 15' }]);

  // "Entregada": llega todo lo que faltaba.
  const r2 = ordenes.recibirOrden(o.id, { folio: 'F2' });
  assert.equal(r2.completa, true);
  assert.equal(r2.orden.estado, 'surtida');
  assert.deepEqual(ordenes.entradas()[0].renglones.map((r) => r.cantidad), ['200', '20']);
  assert.throws(() => ordenes.recibirOrden(o.id, { folio: 'F3' }), /no está en Aprobadas/);
});

test('Max: compra cancelada en SICAR pasa a Canceladas si sigue en Aprobadas', () => {
  ordenes.importarDeSicar([{ ...COMPRA, externo: '2321' }]);
  assert.ok(ordenes.externasAbiertas().includes('2321'));
  assert.equal(ordenes.cancelarDeSicar(['2321', '2320']), 1); // la 2320 ya está surtida: no se toca
  assert.equal(ordenes.listar().find((x) => x.externo === '2321').estado, 'cancelada');
  assert.equal(ordenes.listar().find((x) => x.externo === '2320').estado, 'surtida');
});
