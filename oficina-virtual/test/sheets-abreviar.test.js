const test = require('node:test');
const assert = require('node:assert/strict');
const { materialesDeNota, abreviar, leerLinea } = require('../src/integraciones/sheets/abreviar');

const a = (cantidad, unidad, nombre) => abreviar({ cantidad, unidad, nombre })?.texto ?? null;

test('cemento por marca, sin "25 KG" ni "CEMEX"', () => {
  assert.equal(a(8, 'bulto', 'Cemento Maya 25 kg'), '8 MAYA');
  assert.equal(a(15, 'pz', 'CEMENTO APASCO 25 KG'), '15 APASCO');
  assert.equal(a(4, null, 'CEMENTO MAYA 25 KG CEMEX'), '4 MAYA');
  assert.equal(a(2, 'pz', 'CEMENTO HOLCIM 25 KG'), '2 HOLCIM');
});

test('metros, bolsas, block y varilla en forma corta', () => {
  assert.equal(a(1, 'm³', 'POLVO'), '1M POLVO');
  assert.equal(a(0.5, 'm³', 'GRAVA'), '.5M GRAVA');
  assert.equal(a(1.5, 'm³', 'Polvo'), '1.5M POLVO');
  assert.equal(a(5, null, 'POLVO POR BOLSA'), '5 B POLVO');
  assert.equal(a(3, 'pz', 'GRAVA POR BOLSA'), '3 B GRAVA');
  assert.equal(a(10, null, 'BLOCK DE DIEZ PROCON 10X20X40'), '10 B 10');
  assert.equal(a(100, 'pz', 'Block 15x20x40'), '100 B 15');
  assert.equal(a(10, 'pz', 'VARILLA 3/8'), '10 V 3/8');
  assert.equal(a(1, 'pz', 'RECOCIDO'), '1 RECOCIDO');
});

test('el servicio de envío no se anota como material', () => {
  assert.equal(a(1, null, 'SERVICIO DE ENVIO'), null);
});

test('leerLinea entiende el detalle de Pulpos y de SICAR', () => {
  assert.deepEqual(leerLinea('4 × CEMENTO MAYA 25 KG CEMEX'), { cantidad: 4, unidad: null, nombre: 'CEMENTO MAYA 25 KG CEMEX' });
  assert.deepEqual(leerLinea('7 m³ POLVO'), { cantidad: 7, unidad: 'm³', nombre: 'POLVO' });
  assert.deepEqual(leerLinea('10 bulto CEMENTO'), { cantidad: 10, unidad: 'bulto', nombre: 'CEMENTO' });
});

test('nota de Pulpos con varios productos: cemento aparte del resto', () => {
  const nota = {
    material: 'CEMENTO MAYA 25 KG CEMEX (+4)', cantidad: 4, unidad: 'pz',
    detalle: '4 × CEMENTO MAYA 25 KG CEMEX\n5 × POLVO POR BOLSA\n3 × GRAVA POR BOLSA\n10 × BLOCK DE DIEZ PROCON 10X20X40\n1 × SERVICIO DE ENVIO',
  };
  assert.deepEqual(materialesDeNota(nota), { cemento: ['4 MAYA'], otros: ['5 B POLVO', '3 B GRAVA', '10 B 10'] });
});

test('nota de un solo producto', () => {
  assert.deepEqual(materialesDeNota({ material: 'POLVO', cantidad: 7, unidad: 'm³', detalle: null }), { cemento: [], otros: ['7M POLVO'] });
});
