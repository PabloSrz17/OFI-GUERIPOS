const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

// Base de datos de prueba: nunca la real. Debe ir antes de cargar los módulos.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');

const db = require('../src/db/connection');
const pin = require('../src/lib/pin');

const PIN = '739251';
let base;
let servidor;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/pin', pin.router);
  app.use(pin.proteger);
  app.get('/', (req, res) => res.send('oficina'));
  app.get('/whatsapp.html', (req, res) => res.send('qr'));
  app.get('/js/app.js', (req, res) => res.send('codigo'));
  app.get('/api/notas', (req, res) => res.json([{ folio: 'SECRETO' }]));
  app.get('/api/cotizaciones/fotos/a.jpg', (req, res) => res.send('foto'));
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  await new Promise((listo) => { servidor = app.listen(0, '127.0.0.1', listo); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => servidor.close());

const pedir = (ruta, cookie) => fetch(base + ruta, { redirect: 'manual', headers: cookie ? { cookie } : {} });
const mandar = (ruta, pinTexto, cookie) => fetch(`${base}/api/pin/${ruta}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: JSON.stringify({ pin: pinTexto }),
});
const cookieDe = (r) => r.headers.get('set-cookie')?.split(';')[0];

test('sin PIN creado tampoco se ve nada', async () => {
  assert.equal((await pedir('/api/notas')).status, 401);
  assert.equal((await pedir('/')).headers.get('location'), '/login.html');
  assert.equal((await pedir('/api/health')).status, 200);
  assert.deepEqual(await (await pedir('/api/pin/estado')).json(), { hayPin: false, puedeCrear: true, dentro: false });
});

test('PIN débil no se acepta', () => {
  for (const malo of ['123', '123456', '111111', '654321', 'abcdef', '12345678901234', '']) assert.ok(pin.problemaDelPin(malo), malo);
  assert.equal(pin.problemaDelPin(PIN), null);
});

test('crear, entrar, salir', async () => {
  assert.equal((await mandar('crear', '123456')).status, 400);
  const creado = await mandar('crear', PIN);
  assert.equal(creado.status, 201);
  const cookie = cookieDe(creado);
  assert.match(creado.headers.get('set-cookie'), /HttpOnly/);
  assert.match(creado.headers.get('set-cookie'), /SameSite=Strict/);

  // El PIN nunca se guarda tal cual; ni la sesión.
  const guardado = JSON.stringify(db.prepare(`SELECT * FROM ajustes`).all()) + JSON.stringify(db.prepare('SELECT * FROM sesiones').all());
  assert.ok(!guardado.includes(PIN));
  assert.ok(!guardado.includes(cookie.split('=')[1]));

  assert.equal((await mandar('crear', '987123')).status, 409); // no se puede reemplazar

  for (const ruta of ['/', '/whatsapp.html', '/js/app.js', '/api/notas', '/api/cotizaciones/fotos/a.jpg']) {
    assert.equal((await pedir(ruta, cookie)).status, 200, ruta);
    assert.notEqual((await pedir(ruta)).status, 200, ruta);
    assert.notEqual((await pedir(ruta, 'oficina_sesion=inventada')).status, 200, ruta);
  }

  assert.equal((await mandar('salir', '', cookie)).status, 200);
  assert.equal((await pedir('/api/notas', cookie)).status, 401);

  const entra = await mandar('entrar', PIN);
  assert.equal(entra.status, 200);
  assert.equal((await pedir('/api/notas', cookieDe(entra))).status, 200);
  assert.equal((await mandar('entrar', '000111')).status, 401);
});

test('muchos intentos bloquean, aun con el PIN correcto', async () => {
  await mandar('entrar', PIN); // limpia la cuenta de la prueba anterior
  for (let i = 0; i < 5; i++) assert.equal((await mandar('entrar', '000111')).status, 401);
  assert.equal((await mandar('entrar', PIN)).status, 429);
});

test('una sesión vencida ya no sirve; borrar el PIN cierra todas', async () => {
  const fila = db.prepare('SELECT hash FROM sesiones LIMIT 1').get();
  assert.ok(fila);
  db.prepare('INSERT OR REPLACE INTO ajustes (clave, valor) VALUES (?, ?)').run('marca', '1');
  pin.borrarPin();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sesiones').get().n, 0);
  assert.equal((await (await pedir('/api/pin/estado')).json()).hayPin, false);
});
