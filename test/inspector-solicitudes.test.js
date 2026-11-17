const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. Sin clave de IA: no se gasta nada.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');
delete process.env.ANTHROPIC_API_KEY;

const { pideCotizacion, procesarMensaje } = require('../src/integraciones/inspector/solicitudes');

test('las palabras clave, sin importar mayúsculas ni acentos', () => {
  for (const si of [
    'Necesito material para una obra', 'NECESITO MATERIALES', 'necesito  material', 'Requiero material',
    'requiero matererial urgente', 'Cotización por favor', 'una cotizacion de grava', 'COTIZACIÓN',
    'Me pasa un presupuesto', 'PRESUPUESTO', 'Néçesito material'.replace('ç', 'c'),
    'Hola, me puedes cotizar 10 cementos', 'Para cotizar 3 metros de polvo', 'me cotiza 7 metros de grava',
    'Cotízame eso', 'Cotíceme esto por favor', 'cotizar', 'Cotizar por favor', 'COTIZAR POR FAVOR', 'cotisar porfa',
  ]) assert.equal(pideCotizacion(si), true, si);
});

test('todo lo demás queda libre para la atención manual', () => {
  for (const no of [
    'Hola buenas tardes', 'ya llegó el camión?', 'cuánto cuesta la grava', 'ocupo 20 bultos de cemento',
    '7 metros de grava', 'necesito factura', 'gracias', '', null,
  ]) assert.equal(pideCotizacion(no), false, String(no));
});

function mensaje(body, { numero = '5219990000001', type = 'chat' } = {}) {
  const enviados = [];
  return {
    enviados,
    type,
    body,
    from: `${numero}@c.us`,
    timestamp: Math.floor(Date.now() / 1000),
    getContact: async () => ({ id: { user: numero } }),
    client: { sendMessage: async (_a, t) => { enviados.push(t); } },
  };
}

test('sin la palabra clave no contesta nada; con ella, da la bienvenida', async () => {
  const hola = mensaje('Hola, ya llegó mi pedido?');
  await procesarMensaje(hola);
  assert.equal(hola.enviados.length, 0);

  const pide = mensaje('Buen día, necesito material');
  await procesarMensaje(pide);
  assert.equal(pide.enviados.length, 1);
  assert.match(pide.enviados[0], /material/i);
});

test('quien ya pidió cotización puede seguir contestando sin repetir la palabra', async () => {
  const numero = '5219990000002';
  await procesarMensaje(mensaje('Cotización', { numero }));
  // Sigue en la plática: no se le da otra bienvenida ni se ignora; su texto se junta.
  const sigue = mensaje('Colonia Pensiones', { numero });
  await procesarMensaje(sigue);
  assert.equal(sigue.enviados.length, 0);
  const db = require('../src/db/connection');
  const { textos } = db.prepare('SELECT textos FROM conversaciones_whatsapp WHERE clave LIKE ?').get(`%9990000002`);
  assert.match(textos, /Pensiones/);
  // Quien no ha pedido nada no deja rastro.
  await procesarMensaje(mensaje('Hola', { numero: '5219990000003' }));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conversaciones_whatsapp WHERE clave LIKE ?').get('%9990000003').n, 0);
});

test('la lista de hace menos de 2 minutos se junta con "cotizar por favor"', async () => {
  const numero = '5219990000005';
  const db = require('../src/db/connection');
  const lista = mensaje('8 bultos de cemento\n3 kg de alambre', { numero });
  await procesarMensaje(lista);
  assert.equal(lista.enviados.length, 0); // la lista sola no contesta ni deja rastro
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conversaciones_whatsapp WHERE clave LIKE ?').get('%9990000005').n, 0);
  await procesarMensaje(mensaje('cotizar por favor', { numero }));
  const { textos } = db.prepare('SELECT textos FROM conversaciones_whatsapp WHERE clave LIKE ?').get('%9990000005');
  assert.equal(textos, '8 bultos de cemento\n3 kg de alambre\ncotizar por favor');
});

test('lo de hace más de 2 minutos no se junta', async () => {
  const numero = '5219990000006';
  const db = require('../src/db/connection');
  const vieja = mensaje('Ya llegó mi pedido?', { numero });
  vieja.timestamp -= 121;
  await procesarMensaje(vieja);
  await procesarMensaje(mensaje('cotizar', { numero }));
  assert.equal(db.prepare('SELECT textos FROM conversaciones_whatsapp WHERE clave LIKE ?').get('%9990000006').textos, 'cotizar');
});

test('no se mezclan los mensajes de otro número', async () => {
  const db = require('../src/db/connection');
  await procesarMensaje(mensaje('5 metros de grava', { numero: '5219990000007' }));
  await procesarMensaje(mensaje('cotizar', { numero: '5219990000008' }));
  assert.equal(db.prepare('SELECT textos FROM conversaciones_whatsapp WHERE clave LIKE ?').get('%9990000008').textos, 'cotizar');
});

test('una foto y luego "cotizar": ahí sí se descarga y sale su tarjeta', async () => {
  process.env.ANTHROPIC_API_KEY = 'prueba-sin-uso';
  try {
    const numero = '5219990000009';
    const { pendientes } = require('../src/integraciones/inspector/solicitudes');
    const foto = mensaje('', { numero, type: 'image' });
    let descargas = 0;
    foto.id = { id: 'B' };
    foto.client.pupPage = { evaluate: async () => { descargas += 1; return null; } };
    await procesarMensaje(foto);
    assert.equal(descargas, 0);
    await procesarMensaje(mensaje('cotizar por favor', { numero }));
    assert.equal(descargas, 1);
    assert.ok(pendientes().some((s) => /9990000009/.test(s.telefono ?? '') && /cotizar por favor/.test(s.mensaje)));
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('una foto sin la palabra clave se ignora: ni se descarga', async () => {
  process.env.ANTHROPIC_API_KEY = 'prueba-sin-uso';
  try {
    const foto = mensaje('mira esto', { numero: '5219990000004', type: 'image' });
    let descargas = 0;
    foto.client.pupPage = { evaluate: async () => { descargas += 1; return null; } };
    foto.id = { id: 'A' };
    await procesarMensaje(foto);
    assert.equal(descargas, 0);
    assert.equal(foto.enviados.length, 0);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('la etiqueta SALIDA sólo en notas a mano de N001 a N1000', async () => {
  const { etiquetaOrigen } = await import('../public/js/kanban.js');
  const et = (origen, folio) => etiquetaOrigen({ origen, folio })?.texto ?? null;
  for (const f of ['N001', 'N1', 'n45', 'N999', 'N1000', ' N0500 ']) assert.equal(et('sicar', f), 'SALIDA', f);
  for (const f of ['N000', 'N1001', '33219', 'A500', 'N12B', 'N-5', '']) assert.equal(et('sicar', f), 'SC', f);
  assert.equal(et('pulpos', 'N500'), 'PS'); // los folios de Pulpos usan la misma numeración
  assert.equal(et('whatsapp', 'WA-5'), 'WA');
  assert.equal(et('manual', 'N500'), null);
});

test('la bienvenida sólo pregunta lo que el cliente no dijo', () => {
  const { bienvenida } = require('../src/integraciones/whatsapp/mensajes');
  const completa = bienvenida(new Date());
  assert.match(completa, /material/);
  assert.match(completa, /colonia/);
  assert.match(completa, /pagar/);
  const soloColonia = bienvenida(new Date(), { material: false, colonia: true, pago: false });
  assert.match(soloColonia, /este dato\?/);
  assert.match(soloColonia, /colonia/);
  assert.doesNotMatch(soloColonia, /material|pagar/);
  assert.doesNotMatch(soloColonia, /\$/); // nunca precios
});
