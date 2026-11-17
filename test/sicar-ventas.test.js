const test = require('node:test');
const assert = require('node:assert/strict');
const { revisarSQL, leer, ventasDesde, canceladasDe } = require('../src/integraciones/sicar/consultas');

const FILA = {
  ven_id: 33473, folio: 33370, fecha: '2026-11-06 11:44:23', total: '1535.00', status: 1, cli_id: 9, nombre: 'ALEJANDRO MARIN',
  domicilio: 'PROL ALLENDE', noExt: '', colonia: 'LOMAS DE PEDREGAL', localidad: '', ciudad: '', celular: '981 103 7561', telefono: '', referencia: 'PORTON CHOCOLATE',
};
const RENGLONES = [
  { ven_id: 33473, descripcion: 'SERVICIO DE ENVIO', cantidad: '1.0000', unidad: 'PZA' },
  { ven_id: 33473, descripcion: 'VARILLA DE 3/8" CORRUGADA', cantidad: '1.0000', unidad: 'PIEZA' },
  { ven_id: 33473, descripcion: 'GRAVA POR BOLSA C/B', cantidad: '10.0000', unidad: 'PZA' },
];
const poolFalso = (filas, renglones) => ({
  query: async (sql) => [/FROM venta/.test(sql) ? filas : renglones],
});

test('SICAR: entra la nota con cliente, dirección y celular, como la captura a mano', async () => {
  const sinEnvio = { ...FILA, ven_id: 2, folio: 2 };
  const publico = { ...FILA, ven_id: 3, folio: 3, cli_id: 1, nombre: 'PÚBLICO EN GENERAL' };
  const cancelada = { ...FILA, ven_id: 4, folio: 4, status: -1 };
  const sinCelular = { ...FILA, ven_id: 5, folio: 5, celular: '', telefono: '' };
  const sinDireccion = { ...FILA, ven_id: 6, folio: 6, domicilio: ' ' };
  const renglones = [...RENGLONES, { ven_id: 2, descripcion: 'CEMENTO', cantidad: '2', unidad: 'PZA' }];
  const ventas = await ventasDesde(poolFalso([FILA, sinEnvio, publico, cancelada, sinCelular, sinDireccion], renglones), new Date(2026, 10, 6));
  assert.deepEqual(ventas.map((v) => v.nota.folio), ['33370', '2']);
  const { cliente, nota } = ventas[0];
  assert.equal(cliente.nombre, 'ALEJANDRO MARIN');
  assert.equal(nota.telefono, '529811037561');
  assert.equal(nota.material, 'VARILLA DE 3/8" CORRUGADA');
  assert.equal(nota.detalle, '1 pz VARILLA DE 3/8" CORRUGADA\n10 pz GRAVA POR BOLSA CON BOLSA'); // sin el envío
  assert.equal(nota.direccion, 'PROL ALLENDE, COL LOMAS DE PEDREGAL · PORTON CHOCOLATE');
  assert.equal(nota.total, 1535);
});

test('SICAR: canceladasDe pregunta sólo por folios numéricos y devuelve los cancelados', async () => {
  let enviado = null;
  const pool = { query: async (sql, params) => { enviado = { sql, params }; return [[{ not_id: 33325 }]]; } };
  assert.deepEqual(await canceladasDe(pool, ['33325', '33326', '33325', 'N1023']), ['33325']);
  assert.deepEqual(enviado.params, [33325, 33326]);
  assert.match(enviado.sql, /status <> 1/);
  assert.deepEqual(await canceladasDe(pool, ['N1']), []);
});

test('SICAR: deja pasar SELECT sobre ventas, renglones y cliente', () => {
  for (const sql of [
    'SELECT 1',
    'SELECT * FROM venta WHERE fecha >= ?',
    'SELECT v.folio, d.cantidad FROM venta v JOIN detallev d ON d.ven_id = v.ven_id LEFT JOIN cliente c ON c.cli_id = v.cli_id;',
    'select total from `sicar`.`venta`',
  ]) assert.doesNotThrow(() => revisarSQL(sql), sql);
});

test('SICAR: rechaza inventario, escrituras y trucos', () => {
  for (const sql of [
    'SELECT * FROM articulo',
    'SELECT existencia FROM venta',
    'SELECT * FROM venta JOIN inventario i ON 1',
    'SELECT * FROM articulo a JOIN compra c ON 1',
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
