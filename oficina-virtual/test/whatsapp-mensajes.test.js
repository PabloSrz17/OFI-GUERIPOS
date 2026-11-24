const test = require('node:test');
const assert = require('node:assert/strict');
const { enRuta } = require('../src/integraciones/whatsapp/mensajes');

const NOTA = {
  folio: 'N925', cliente: 'JHONY P.', cantidad: 10, unidad: 'pz', material: 'CEMENTO HOLCIM 25 KG',
  chofer: 'Moises Sosa', camion: 'Ram 4000', direccion: 'C. Pablo García, Pensiones',
};

test('mensaje "va en camino" con los datos de la nota', () => {
  const texto = enRuta(NOTA);
  assert.match(texto, /^¡Hola Jhony! 👋/);
  assert.match(texto, /\*N925\* ya va en camino/);
  assert.match(texto, /10 pz de cemento holcim 25 kg/);
  assert.match(texto, /Lo lleva: Moises Sosa en la Ram 4000/);
  assert.match(texto, /Entrega en: C\. Pablo García, Pensiones/);
});

test('lista todos los materiales de la nota, de Pulpos y de SICAR', () => {
  const pulpos = enRuta({
    ...NOTA,
    cantidad: 6,
    material: 'CEMENTO HOLCIM 25 KG',
    detalle: '6 × CEMENTO HOLCIM 25 KG\n0.5 × POLVO POR METRO\n0.5 × GRAVA POR METRO\n1 × MASILLA FIBRATADA CEPSSA 20 KG - GRIS\n1 × SERVICIO DE ENVIO',
  });
  for (const l of ['• 6 cemento holcim 25 kg', '• 0.5 polvo por metro', '• 0.5 grava por metro', '• 1 masilla fibratada cepssa 20 kg - gris']) assert.ok(pulpos.includes(l), l);
  assert.doesNotMatch(pulpos, /servicio de envio/i);
  // Cada renglón una sola vez: el principal ya viene en la lista.
  assert.equal(pulpos.match(/cemento holcim/g).length, 1);

  const sicar = enRuta({ ...NOTA, detalle: '3/4 m³ ARENA\n1/2 m³ GRAVA\n10 bulto CEMENTO' });
  for (const l of ['• 3/4 m³ arena', '• 1/2 m³ grava', '• 10 bulto cemento']) assert.ok(sicar.includes(l), l);
  // El orden: pedido, materiales, quién lo lleva, dirección.
  assert.ok(sicar.indexOf('va en camino') < sicar.indexOf('arena'));
  assert.ok(sicar.indexOf('cemento') < sicar.indexOf('Lo lleva'));
  assert.ok(sicar.indexOf('Lo lleva') < sicar.indexOf('Entrega en'));
});

test('el cliente nunca ve los avisos internos', () => {
  const con = enRuta({ ...NOTA, detalle: '2 × GRAVA\n⚠️ REVISAR EN PULPOS: lo leído suma $200 y la venta dice $400' });
  assert.match(con, /• 2 grava/);
  assert.doesNotMatch(con, /REVISAR|PULPOS/i);
  const sin = enRuta({ ...NOTA, material: 'VER EN PULPOS: NO SE PUDIERON LEER LOS PRODUCTOS', detalle: '⚠️ REVISAR EN PULPOS: no se pudo leer ningún producto' });
  assert.doesNotMatch(sin, /PULPOS/i);
  assert.match(sin, /Los materiales de tu nota/);
  // Sólo el envío en el detalle: se usa el material principal.
  assert.match(enRuta({ ...NOTA, detalle: '1 × SERVICIO DE ENVIO' }), /10 pz de cemento holcim/);
});

test('sin saludo por nombre para "Público en general" y sin chofer', () => {
  const texto = enRuta({ ...NOTA, cliente: 'PÚBLICO EN GENERAL', chofer: null });
  assert.match(texto, /^¡Hola! 👋/);
  assert.doesNotMatch(texto, /Lo lleva/);
});
