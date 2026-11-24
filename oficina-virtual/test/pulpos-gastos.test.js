const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. Debe ir antes de cargar los módulos.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');

const db = require('../src/db/connection');
const gastos = require('../src/integraciones/pulpos/gastos');
const reporte = require('../src/repositories/reporte.repo');

// Como los manda la Caja de Pulpos (cashierAudits.cashMovements).
const mov = (id, details, amount, createdAt = '2026-10-27T15:26:42.094Z', extra = {}) =>
  ({ id, createdAt, deletedAt: null, details, amount: String(amount), currency: 'MXN', type: 'MANUAL_MOVEMENT', ...extra });

const caja = [
  mov('a1', 'desa cindy ', -200),
  mov('a2', 'gas nissan blanca', -500),
  mov('a3', 'GAS NISSAN ROJA', -500, '2026-10-27T14:48:42.572Z'),
  mov('a4', 'mon', 2497),
  mov('a5', 'diesel torton', -1200, '2026-10-28T16:00:00.000Z'),
  mov('a6', 'gasolina', -300, '2026-10-28T17:00:00.000Z'),
  mov('a7', 'gas ram', -400, '2026-10-28T18:00:00.000Z', { deletedAt: '2026-10-28T18:05:00.000Z' }), // borrado en Pulpos
  mov('a8', 'llanta nissan roja', -900), // de la unidad, pero no es combustible
];

test('de la Caja de Pulpos sólo pasan los retiros de combustible, con su unidad', () => {
  const cargas = gastos.aCargas(caja);
  assert.deepEqual(cargas.map((c) => [c.pulpos_id, c.unidad, c.importe, c.concepto]), [
    ['a2', 'NISSAN BLANCA', 500, 'gasolina'],
    ['a3', 'NISSAN ROJA', 500, 'gasolina'],
    ['a5', 'TORTON', 1200, 'diesel'],
    ['a6', 'SIN UNIDAD', 300, 'gasolina'],
  ]);
  assert.equal(cargas[0].reporto, 'Pulpos (caja)');
  assert.equal(cargas[0].creado_en, gastos.horaLocal('2026-10-27T15:26:42.094Z'));
});

test('cada movimiento se anota una sola vez y sale en el Reporte semanal de Edgar', () => {
  assert.equal(gastos.anotar(caja).length, 4);
  assert.equal(gastos.anotar(caja).length, 0); // la siguiente vuelta del robot no repite nada
  assert.equal(gastos.anotar([...caja, mov('b1', 'gas F450', -650, '2026-10-29T15:00:00.000Z')]).length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM combustible WHERE reporto = 'Pulpos (caja)'").get().n, 5);

  const { combustible } = reporte.generar('2026-10-30').edgar;
  assert.equal(combustible.importe, 500 + 500 + 1200 + 300 + 650);
  assert.deepEqual(
    Object.fromEntries(combustible.por_unidad.map((u) => [u.unidad, u.importe])),
    { 'NISSAN BLANCA': 500, 'NISSAN ROJA': 500, TORTON: 1200, 'SIN UNIDAD': 300, 'FORD F450': 650 },
  );
});

test('la misma carga reportada por WhatsApp y retirada en caja cuenta una sola vez (en cualquier orden)', () => {
  const contar = () => db.prepare("SELECT COUNT(*) AS n FROM combustible WHERE date(creado_en) = date('now', 'localtime')").get().n;
  const ahora = new Date().toISOString();
  const anotarAMano = db.prepare(`INSERT INTO combustible (unidad, importe, concepto, reporto, mensaje)
    VALUES (?, ?, 'gasolina', 'Pablo Suarez', 'Edgar, la nissan roja echó 777')`);

  // 1) Primero WhatsApp ("NISSAN ROJA"), luego el retiro en caja: se liga, no se duplica.
  anotarAMano.run('NISSAN ROJA', 777);
  assert.equal(gastos.anotar([mov('c1', 'GAS NISSAN ROJA', -777, ahora)]).length, 0);
  assert.equal(contar(), 1);
  assert.equal(gastos.anotar([mov('c1', 'GAS NISSAN ROJA', -777, ahora)]).length, 0);
  assert.equal(contar(), 1);

  // 2) Primero el retiro en caja, luego lo reportan ("RAM 4000" = RAM): se completa esa fila.
  assert.equal(gastos.anotar([mov('c2', 'gas ram', -888, ahora)]).length, 1);
  assert.equal(gastos.emparejarReporte({ unidad: 'RAM 4000', importe: 888, litros: 35, reporto: 'Pablo Suarez' }), true);
  assert.equal(contar(), 2);
  const fila = db.prepare("SELECT unidad, reporto, litros, pulpos_id FROM combustible WHERE pulpos_id = 'c2'").get();
  assert.deepEqual(fila, { unidad: 'RAM', reporto: 'Pablo Suarez', litros: 35, pulpos_id: 'c2' });
  // Una segunda carga igual reportada aparte sí es otra carga.
  assert.equal(gastos.emparejarReporte({ unidad: 'RAM', importe: 888, reporto: 'Pablo Suarez' }), false);

  // Otra unidad con el mismo importe no se confunde.
  assert.equal(gastos.anotar([mov('c3', 'gas torton', -777, ahora)]).length, 1);
  assert.equal(contar(), 3);
});

test('si borran el retiro en Pulpos, Edgar lo quita; tras el corte de caja no borra nada', () => {
  const de = (id) => db.prepare('SELECT id, reporto, pulpos_id FROM combustible WHERE pulpos_id = ? OR mensaje = ?').get(id, id);
  const base = [mov('d0', 'bch', 3200, '2026-11-02T14:00:00.000Z')];
  const prueba = mov('d1', 'gas prueba', -1, '2026-11-02T19:14:52.000Z');
  const reportada = mov('d2', 'gas torton', -950, '2026-11-02T19:30:00.000Z');
  // Para la prueba "hoy" es el 2 de noviembre: se ajustan las fechas a hoy para que entren en la ventana de 3 días.
  const hoy = (m) => ({ ...m, createdAt: new Date(Date.now() - (Date.parse('2026-11-02T20:00:00.000Z') - Date.parse(m.createdAt))).toISOString() });
  const [b0, p1, r2] = [base[0], prueba, reportada].map(hoy);

  gastos.anotar([b0, p1, r2]);
  gastos.emparejarReporte({ unidad: 'TORTON', importe: 950, reporto: 'Moisés' }); // también la avisaron por WhatsApp
  assert.ok(de('d1'));
  assert.equal(de('d2').reporto, 'Moisés');

  // Corte de caja: la Caja nueva sólo trae movimientos posteriores. No se borra nada.
  gastos.anotar([{ ...b0, id: 'd9', createdAt: new Date(Date.now() + 60_000).toISOString() }]);
  assert.ok(de('d1'));
  assert.ok(de('d2'));

  // Borran los dos retiros en Pulpos (siguen los movimientos anteriores): el de Pulpos se quita, el reportado se queda.
  assert.equal(gastos.quitarBorrados([b0]), 2);
  assert.equal(de('d1'), undefined);
  assert.equal(db.prepare("SELECT pulpos_id FROM combustible WHERE reporto = 'Moisés' AND importe = 950").get().pulpos_id, null);
});
