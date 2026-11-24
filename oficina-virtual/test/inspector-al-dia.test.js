const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de prueba, nunca la real. Sin clave de IA: no se gasta nada.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');
delete process.env.ANTHROPIC_API_KEY;

const db = require('../src/db/connection');
const { procesarMensaje, ponerseAlDia } = require('../src/integraciones/inspector/solicitudes');

let n = 0;
function mensaje(body, { numero = '5219990000101', haceS = 0 } = {}) {
  const enviados = [];
  return {
    enviados,
    id: { id: `ID${++n}` },
    type: 'chat',
    body,
    from: `${numero}@c.us`,
    timestamp: Math.floor(Date.now() / 1000) - haceS,
    getContact: async () => ({ id: { user: numero } }),
    client: { sendMessage: async (_a, t) => { enviados.push(t); } },
  };
}
const tarjetas = (numero) => db.prepare('SELECT COUNT(*) AS n FROM solicitudes_whatsapp WHERE telefono LIKE ?').get(`%${numero.slice(-10)}`).n;

test('la primera vez sólo apunta la hora y no trae nada viejo', async () => {
  let pidio = false;
  const leidos = await ponerseAlDia({ mensajesDesde: async () => { pidio = true; return []; } }, () => {});
  assert.equal(leidos, 0);
  assert.equal(pidio, false);
});

test('la cotización de la noche sale como tarjeta, sin contestarle al cliente', async () => {
  const numero = '5219990000102';
  const noche = mensaje('Buenas noches, necesito material', { numero, haceS: 8 * 3600 });
  await procesarMensaje(noche);
  assert.equal(noche.enviados.length, 0);
  assert.equal(tarjetas(numero), 1);
});

test('el mismo mensaje no se pasa dos veces', async () => {
  const numero = '5219990000103';
  const m = mensaje('cotización por favor', { numero, haceS: 3600 });
  await procesarMensaje(m);
  await procesarMensaje(m);
  assert.equal(tarjetas(numero), 1);
});

test('al conectar lee desde el último mensaje y salta lo ya leído', async () => {
  const numero = '5219990000104';
  const ya = mensaje('cotizar', { numero, haceS: 7200 });
  await procesarMensaje(ya);
  let desde = null;
  const nuevo = mensaje('presupuesto de grava', { numero: '5219990000105', haceS: 600 });
  const cola = [];
  await ponerseAlDia({ mensajesDesde: async (d) => { desde = d; return [ya, nuevo]; } }, (m) => cola.push(m));
  assert.ok(desde > Date.now() / 1000 - 3 * 24 * 3600);
  for (const m of cola) await procesarMensaje(m);
  assert.equal(tarjetas(numero), 1);
  assert.equal(tarjetas('5219990000105'), 1);
});

test('lo que no pide cotización de noche no deja rastro', async () => {
  const m = mensaje('Hola, a qué hora abren?', { numero: '5219990000106', haceS: 5 * 3600 });
  await procesarMensaje(m);
  assert.equal(m.enviados.length, 0);
  assert.equal(tarjetas('5219990000106'), 0);
});
