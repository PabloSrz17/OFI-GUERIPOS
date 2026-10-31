const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. Sin clave de IA: no se gasta ni sale nada.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');
delete process.env.ANTHROPIC_API_KEY;

const { aNumero, calcular } = require('../src/integraciones/inspector/cotizador');
const solicitudes = require('../src/integraciones/inspector/solicitudes');

test('las fracciones se convierten para calcular el importe', () => {
  assert.equal(aNumero('1/2'), 0.5);
  assert.equal(aNumero('1 1/2'), 1.5);
  assert.equal(aNumero('7'), 7);
  assert.equal(aNumero('1,5'), 1.5);
  assert.ok(Number.isNaN(aNumero('1/0')));
  assert.ok(Number.isNaN(aNumero('')));
  assert.ok(Number.isNaN(aNumero('media')));
  const r = calcular([{ descripcion: 'Grava', cantidad: '1/2', precio: 550 }]);
  assert.equal(r.total, 275);
  assert.throws(() => calcular([{ descripcion: 'Grava', cantidad: 'media', precio: 550 }]), /Cantidad inválida/);
});

test('sin clave de IA una foto no se descarga ni se contesta', async () => {
  let descargas = 0;
  let enviados = 0;
  await solicitudes.procesarMensaje({
    type: 'image',
    from: '5219810000000@c.us',
    body: '',
    timestamp: Math.floor(Date.now() / 1000),
    getContact: async () => ({ id: { user: '5219810000000' } }),
    downloadMedia: async () => { descargas += 1; },
    client: { sendMessage: async () => { enviados += 1; } },
  });
  assert.equal(descargas, 0);
  assert.equal(enviados, 0);
  assert.equal(solicitudes.pendientes().length, 0);
});

test('la foto se busca por id.id, porque id._serialized llega vacío en vivo', async () => {
  const { bajarImagen } = require('../src/integraciones/whatsapp/medios');
  const foto = { mimetype: 'image/jpeg', data: 'AAAA' };
  let idPedido = null;
  const pagina = { evaluate: async (_fn, id) => { idPedido = id; return foto; } };
  assert.equal(await bajarImagen({ id: { id: 'ABC', fromMe: false }, client: { pupPage: pagina } }), foto);
  assert.equal(idPedido, 'ABC');
});

test('un sticker o un audio se ignoran', async () => {
  for (const type of ['sticker', 'ptt', 'video']) {
    await solicitudes.procesarMensaje({ type, from: '5219810000000@c.us', body: '', timestamp: Math.floor(Date.now() / 1000) });
  }
  assert.equal(solicitudes.pendientes().length, 0);
});
