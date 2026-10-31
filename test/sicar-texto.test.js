const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretar, parseProducto } = require('../src/integraciones/sicar/texto');

test('nota completa con varios productos, total y hora', () => {
  const r = interpretar('33219, Luis Roman, 7 m3 polvo + 10 bultos cemento, Calle 5 #20 Centro, $3,500, 10:25');
  assert.equal(r.ok, true);
  assert.deepEqual(r.nota, {
    origen: 'sicar',
    folio: '33219',
    cliente: 'LUIS ROMAN',
    material: 'POLVO',
    cantidad: 7,
    unidad: 'm³',
    detalle: '7 m³ POLVO\n10 bulto CEMENTO',
    productos: [
      { cantidad: 7, unidad: 'm³', material: 'POLVO' },
      { cantidad: 10, unidad: 'bulto', material: 'CEMENTO' },
    ],
    total: 3500,
    direccion: 'Calle 5 #20 Centro',
    telefono: null,
    hora: '10:25',
  });
});

test('teléfono aparte o dentro de la dirección', () => {
  const aparte = interpretar('33222, Phoibe, 3 m3 arena, Calle 8 #4, tel 981 196 5122');
  assert.equal(aparte.nota.telefono, '529811965122');
  assert.equal(aparte.nota.direccion, 'Calle 8 #4');
  const enDireccion = interpretar('33223, Phoibe, 3 m3 arena, Calle 8 #4 981-117-9760');
  assert.equal(enDireccion.nota.telefono, '529811179760');
});

test('nota mínima; la dirección puede llevar comas', () => {
  const r = interpretar('Folio 33220, Público en general, 3 grava, Av. Juárez 10, col. Centro');
  assert.equal(r.ok, true);
  assert.equal(r.nota.folio, '33220');
  assert.equal(r.nota.unidad, 'm³');
  assert.equal(r.nota.direccion, 'Av. Juárez 10, col. Centro');
  assert.equal(r.nota.total, null);
});

test('cantidades libres: fracciones y anotaciones mixtas', () => {
  const productos = (t) => interpretar(`1, Luis, ${t}, Centro, Calle 5`).nota;
  assert.deepEqual(productos('1/2 m3 grava').productos, [{ cantidad: '1/2', unidad: 'm³', material: 'GRAVA' }]);
  assert.deepEqual(productos('1 1/2 bultos cal').productos, [{ cantidad: '1 1/2', unidad: 'bulto', material: 'CAL' }]);
  assert.deepEqual(productos('1 m³ /2 M3 GRAVA').productos, [{ cantidad: '1 m³ /2 M3', unidad: '', material: 'GRAVA' }]);
  assert.deepEqual(productos('media carga grava').productos, [{ cantidad: 'media carga', unidad: '', material: 'GRAVA' }]);
  assert.equal(productos('3/4 m3 arena + 1/2 m3 grava').detalle, '3/4 m³ ARENA\n1/2 m³ GRAVA');
});

test('sin productos se sigue pidiendo el dato', () => {
  assert.match(interpretar('1, Luis, Calle 5').error, /productos/);
});

test('unidades escritas de varias formas', () => {
  assert.deepEqual(parseProducto('7m3 polvo'), { cantidad: 7, unidad: 'm³', material: 'POLVO' });
  assert.deepEqual(parseProducto('14 metros cubicos de grava'), { cantidad: 14, unidad: 'm³', material: 'GRAVA' });
  assert.deepEqual(parseProducto('1 viaje escombro'), { cantidad: 1, unidad: 'viaje', material: 'ESCOMBRO' });
  assert.deepEqual(parseProducto('20 block'), { cantidad: 20, unidad: 'pz', material: 'BLOCK' });
  assert.deepEqual(parseProducto('1.5 m3 arena'), { cantidad: 1.5, unidad: 'm³', material: 'ARENA' });
});

test('avisa qué falta', () => {
  const r = interpretar('33221, Construcomer');
  assert.equal(r.ok, false);
  assert.match(r.error, /productos/);
  assert.match(r.error, /dirección/);
});
