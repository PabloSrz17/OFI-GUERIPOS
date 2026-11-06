const test = require('node:test');
const assert = require('node:assert/strict');
const { revisarSQL, leer } = require('../src/integraciones/sicar/consultas');

test('SICAR: deja pasar SELECT sobre ventas, renglones y cliente', () => {
  for (const sql of [
    'SELECT 1',
    'SELECT * FROM venta WHERE fecha >= ?',
    'SELECT v.folio, d.cantidad FROM venta v JOIN detallev d ON d.ven_id = v.ven_id LEFT JOIN cliente c ON c.cli_id = v.cli_id;',
    'select total from `sicar`.`venta`',
  ]) assert.doesNotThrow(() => revisarSQL(sql), sql);
});

test('SICAR: rechaza inventario, compras, escrituras y trucos', () => {
  for (const sql of [
    'SELECT * FROM articulo',
    'SELECT existencia FROM venta',
    'SELECT * FROM venta JOIN inventario i ON 1',
    'SELECT * FROM compra',
    'SELECT * FROM venta v, articulo a',
    'UPDATE venta SET total = 0',
    'DELETE FROM venta',
    'SELECT 1; DROP TABLE venta',
    "SELECT * FROM venta INTO OUTFILE 'x'",
    'SELECT * FROM venta FOR UPDATE',
  ]) assert.throws(() => revisarSQL(sql), /SICAR/, sql);
});

test('SICAR: leer() no manda a MySQL una consulta rechazada', async () => {
  const enviadas = [];
  const pool = { query: async (sql) => { enviadas.push(sql); return [[{ ok: 1 }]]; } };
  assert.deepEqual(await leer(pool, 'SELECT * FROM venta'), [{ ok: 1 }]);
  await assert.rejects(leer(pool, 'SELECT * FROM articulo'), /no es de ventas/);
  assert.deepEqual(enviadas, ['SELECT * FROM venta']);
});
