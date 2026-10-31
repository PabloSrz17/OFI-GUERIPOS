const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizar, buscarEnTexto, formatear } = require('../src/lib/telefono');

test('normalizar acepta formatos comunes de México', () => {
  assert.equal(normalizar('981 196 5122'), '529811965122');
  assert.equal(normalizar('981-196-5122'), '529811965122');
  assert.equal(normalizar('+52 1 981 196 5122'), '529811965122');
  assert.equal(normalizar('529811965122'), '529811965122');
  assert.equal(normalizar('12345'), null);
  assert.equal(normalizar(''), null);
});

test('buscarEnTexto encuentra el teléfono dentro de una dirección', () => {
  assert.equal(buscarEnTexto('C. PABLO GARCIA 981 196 5122, PENSIONES- X MONTECRISTO'), '529811965122');
  assert.equal(buscarEnTexto('CASA VERDE 2 PISOS 981 117 9760, PRESIDENTES'), '529811179760');
  assert.equal(buscarEnTexto('MZA 3 LT 56 FRACC REFORMA CP 24010'), null);
  assert.equal(buscarEnTexto('Lote 22, Desarrollo Altamira'), null);
});

test('formatear', () => {
  assert.equal(formatear('529811965122'), '981 196 5122');
  assert.equal(formatear(null), '');
});
