const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretarSolicitud, buscarPrecio, armarBorrador, calcular, clave } = require('../src/integraciones/inspector/cotizador');

const CATALOGO = [
  { id: 1, nombre: 'Polvo', unidad: 'm³', precio: 550, claves: 'polvo' },
  { id: 3, nombre: 'Cemento Maya 25 kg', unidad: 'bulto', precio: 150, claves: 'cemento maya,maya' },
  { id: 6, nombre: 'Cal', unidad: 'bulto', precio: 110, claves: 'cal' },
  { id: 7, nombre: 'Armex de castillo', unidad: 'pz', precio: 195, claves: 'armex de castillo,armex castillo,castillo' },
];

test('interpreta cliente, productos, colonia y teléfono', () => {
  const r = interpretarSolicitud('Construcomer, 7 m3 polvo + 10 cemento maya, col. Pensiones, tel 981 118 3096');
  assert.equal(r.ok, true);
  assert.equal(r.solicitud.cliente, 'CONSTRUCOMER');
  assert.equal(r.solicitud.colonia, 'Pensiones');
  assert.equal(r.solicitud.telefono, '529811183096');
  assert.deepEqual(r.solicitud.productos.map((p) => [p.cantidad, p.texto]), [[7, 'm3 polvo'], [10, 'cemento maya']]);
});

test('quita "col." o "colonia (de)" del nombre de la colonia', () => {
  assert.equal(interpretarSolicitud('Ana, 3 m3 grava, Colonia de Prueba').solicitud.colonia, 'Prueba');
  assert.equal(interpretarSolicitud('Ana, 3 m3 grava, col Fovi').solicitud.colonia, 'Fovi');
  assert.equal(interpretarSolicitud('Ana, 3 m3 grava, Pensiones').solicitud.colonia, 'Pensiones');
});

test('avisa qué falta', () => {
  const r = interpretarSolicitud('Construcomer, 7 m3 polvo');
  assert.equal(r.ok, false);
  assert.match(r.error, /colonia/);
});

test('busca en el catálogo por palabras completas y la clave más larga', () => {
  assert.equal(buscarPrecio(CATALOGO, 'cemento MAYA').id, 3);
  assert.equal(buscarPrecio(CATALOGO, 'bultos de cal').id, 6);
  assert.equal(buscarPrecio(CATALOGO, 'calle 5'), null);         // "cal" no es "calle"
  assert.equal(buscarPrecio(CATALOGO, 'armex castillo 15x15').id, 7);
  assert.equal(buscarPrecio(CATALOGO, 'block 10x20x40'), null);
});

test('vigas: respeta la medida aunque se haya aprendido "vigas" para otra', () => {
  const vigas = [
    { id: 112, nombre: 'VIGA 5.00 T-12-5 HILOS', unidad: 'pz', precio: 562.5, claves: 'vigas,viga 5 00 t 12 5 hilos' },
    { id: 125, nombre: 'VIGA 4.20 T-12-5 HILOS', unidad: 'pz', precio: 508.2, claves: 'viga 4 20 t 12 5 hilos', actualizado_en: '2026-01-01' },
    { id: 180, nombre: 'VIGA 4.20 T-12-5 HILOS', unidad: 'pz', precio: 525, claves: 'viga 4 20 t 12 5 hilos', actualizado_en: '2026-06-01' },
    { id: 171, nombre: 'Viga de 4.90', unidad: 'pz', precio: 612.5, claves: 'viga de 4 90' },
    { id: 172, nombre: 'Viga de 2 m', unidad: 'pz', precio: 250, claves: 'viga de 2 m' },
  ];
  assert.equal(buscarPrecio(vigas, 'vigas 3.28 m'), null);       // no hay de esa medida: la pone un humano
  assert.equal(buscarPrecio(vigas, 'vigas 7'), null);
  assert.equal(buscarPrecio(vigas, 'vigas 4.90').id, 171);
  assert.equal(buscarPrecio(vigas, 'vigas 4.20').id, 180);        // la de precio más reciente
  assert.equal(buscarPrecio(vigas, 'viga de 2 m').id, 172);
  assert.equal(buscarPrecio(vigas, 'vigas 5.00').id, 112);
  assert.equal(buscarPrecio(vigas, 'vigas'), null);                // sin largo no se escoge uno (23-nov)
});

test('vigas "12-5 de 5.60": 12-5 es el tipo, 5.60 el largo; si no está en la lista sale con su nombre y sin precio', () => {
  const vigas = [
    { id: 112, nombre: 'VIGA 5.00 T-12-5 HILOS', unidad: 'pz', precio: 125, claves: 'vigas,viga 5 00 t 12 5 hilos' },
    { id: 183, nombre: 'VIGA 3.00 T-12-5 HILOS', unidad: 'PZA', precio: 375, claves: 'viga 3 00 t 12 5 hilos' },
    { id: 187, nombre: 'VIGA 2.70 T-12-5 HILOS', unidad: 'pz', precio: 337.5, claves: 'viga 2 70 t 12 5 hilos' },
    { id: 202, nombre: 'VIGA 2.50 T-12-5 HILOS', unidad: 'pza', precio: 312.5, claves: 'vigas 250,viga 2 50 t 12 5 hilos' },
  ];
  const b = armarBorrador({ colonia: 'Fovi', productos: [
    { cantidad: '3', unidad: '', texto: 'vigas 12-5 de 5.60' },
    { cantidad: '2', unidad: '', texto: 'vigas 12-5 de 3.00' },
    { cantidad: '3', unidad: '', texto: 'vigas 12-5 de 2.70' },
    { cantidad: '2', unidad: '', texto: 'vigas 12-5' },
    { cantidad: '3', unidad: '', texto: 'vigas 250' },
  ] }, vigas, null);
  assert.deepEqual(b.partidas.slice(0, -1).map((p) => [p.descripcion, p.cantidad, p.unidad, p.precio]), [
    ['VIGA 5.60 T-12-5 HILOS', '3', 'pza', null],
    ['VIGA 3.00 T-12-5 HILOS', '2', 'pza', 375],
    ['VIGA 2.70 T-12-5 HILOS', '3', 'pza', 337.5],
    ['Vigas 12-5', '2', '', null],
    ['VIGA 2.50 T-12-5 HILOS', '3', 'pza', 312.5],
  ]);
});

test('borrador: precio de lista, producto desconocido y flete sin precio', () => {
  const { solicitud } = interpretarSolicitud('Ana, 7 m3 polvo + 20 block 10x20x40, Fovi');
  const b = armarBorrador(solicitud, CATALOGO, null);
  assert.deepEqual(b.partidas.map((p) => [p.descripcion, p.unidad, p.precio]), [
    ['Polvo', 'm3', 550],
    ['Block 10x20x40', 'pza', null],
    ['Flete a Fovi', 'viaje', null],
  ]);
  const conFlete = armarBorrador(solicitud, CATALOGO, { precio: 350 });
  assert.equal(conFlete.partidas.at(-1).precio, 350);
});

test('en bolsas no toma el precio por m³ de la lista', () => {
  const catalogo = [
    { id: 1, nombre: 'Polvo', unidad: 'm³', precio: 550, claves: 'polvo' },
    { id: 2, nombre: 'Polvo con bolsa', unidad: 'BOLSAS', precio: 45, claves: 'polvo con bolsa' },
  ];
  const partida = (texto, unidad) => armarBorrador({ cliente: 'A', colonia: 'B', productos: [{ cantidad: 10, unidad, texto }] }, catalogo, null).partidas[0];
  assert.equal(partida('polvo', 'BOLSAS').precio, null); // 10 bolsas no son 10 m³ a $550
  assert.equal(partida('polvo', 'BOLSAS').unidad, 'BOLSAS');
  assert.equal(partida('polvo', 'm³').precio, 550);
  assert.equal(partida('polvo con bolsa', 'BOLSAS').precio, 45);
});

test('calcular recalcula importes y total, y exige todos los precios', () => {
  const r = calcular([
    { descripcion: 'Polvo', cantidad: 7, precio: 550 },
    { descripcion: 'Flete a Fovi', cantidad: 1, precio: '350' },
  ]);
  assert.deepEqual(r.partidas.map((p) => p.importe), [3850, 350]);
  assert.equal(r.total, 4200);
  assert.throws(() => calcular([{ descripcion: 'Block', cantidad: 20, precio: null }]), /Falta el precio de "Block"/);
});

test('calcular quita el flete sin precio o en $0', () => {
  const polvo = { tipo: 'producto', descripcion: 'Polvo', cantidad: 1, precio: 550 };
  for (const precio of [null, '', 0, '0']) {
    const r = calcular([polvo, { tipo: 'flete', descripcion: 'Flete a Fovi', cantidad: 1, precio }]);
    assert.equal(r.partidas.length, 1);
    assert.equal(r.total, 550);
  }
});

test('clave quita acentos y signos', () => {
  assert.equal(clave('  Pensiónes,  Fracc. '), 'pensiones fracc');
});
