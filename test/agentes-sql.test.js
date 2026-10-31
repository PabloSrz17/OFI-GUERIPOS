const test = require('node:test');
const assert = require('node:assert/strict');
const { revisarSQL } = require('../src/integraciones/agentes/agentes');

const RUTAS = ['notas', 'choferes', 'camiones', 'clientes'];

test('permite SELECT y WITH sobre tablas del área', () => {
  assert.equal(revisarSQL("SELECT folio FROM notas WHERE estado = 'en_ruta';", RUTAS), null);
  assert.equal(revisarSQL('select n.folio, c.nombre from notas n join choferes c on c.id = n.chofer_id', RUTAS), null);
  assert.equal(revisarSQL('WITH x AS (SELECT * FROM notas) SELECT COUNT(*) FROM x', RUTAS), null);
  assert.match(revisarSQL('WITH x AS (SELECT * FROM precios) SELECT * FROM x', RUTAS), /precios/);
});

test('rechaza escrituras, varias consultas y tablas ajenas', () => {
  assert.match(revisarSQL('DELETE FROM notas', RUTAS), /SELECT/);
  assert.match(revisarSQL('UPDATE notas SET estado = 1', RUTAS), /SELECT/);
  assert.match(revisarSQL('SELECT 1; DROP TABLE notas', RUTAS), /una consulta/);
  assert.match(revisarSQL('SELECT * FROM precios', RUTAS), /Fuera de tu área: precios/);
});
