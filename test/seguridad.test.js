const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// Base de datos de prueba: nunca la real. Debe ir antes de cargar los módulos.
const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-'));
process.env.DB_PATH = path.join(carpeta, 'prueba.sqlite');

const { soloRedLocal, esClienteLocal, esHostLocal, hashesDeScripts } = require('../src/lib/seguridad');
const db = require('../src/db/connection');
const respaldos = require('../src/integraciones/respaldos');

function pedir({ ip = '192.168.1.5', host = '192.168.1.141:3000', method = 'GET', headers = {} }) {
  let codigo = null;
  let siguio = false;
  const res = { status(c) { codigo = c; return this; }, json() { return this; } };
  soloRedLocal({ method, socket: { remoteAddress: ip }, headers: { host, ...headers } }, res, () => { siguio = true; });
  return siguio ? 'pasa' : codigo;
}

test('clientes y nombres locales', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:192.168.1.5', '10.0.0.2', '172.16.3.1']) assert.equal(esClienteLocal(ip), true, ip);
  for (const ip of ['8.8.8.8', '::ffff:200.1.1.1', '172.32.0.1', '', undefined]) assert.equal(esClienteLocal(ip), false, ip);
  for (const h of ['localhost:3000', '127.0.0.1:3000', '192.168.1.141:3000', '[::1]:3000', 'mostrador:3000', 'mostrador.local']) assert.equal(esHostLocal(h), true, h);
  for (const h of ['evil.com', 'abc.ngrok.io:3000', '192.168.1.141.evil.com', '', undefined]) assert.equal(esHostLocal(h), false, h);
});

test('de internet o por túnel no entra; en la red sí', () => {
  assert.equal(pedir({}), 'pasa');
  assert.equal(pedir({ ip: '8.8.8.8' }), 403);
  assert.equal(pedir({ ip: '127.0.0.1', host: 'abc.ngrok.io' }), 403); // un túnel entra por esta misma PC
  assert.equal(pedir({ host: 'ataque.com' }), 403); // DNS apuntado a esta PC
});

test('otra página no puede cambiar datos', () => {
  const m = 'POST';
  assert.equal(pedir({ method: m, headers: { origin: 'http://192.168.1.141:3000', 'sec-fetch-site': 'same-origin' } }), 'pasa');
  assert.equal(pedir({ method: m }), 'pasa'); // sin navegador (scripts locales)
  assert.equal(pedir({ method: m, headers: { origin: 'https://ataque.com' } }), 403);
  assert.equal(pedir({ method: m, headers: { origin: 'null' } }), 403);
  assert.equal(pedir({ method: 'DELETE', headers: { 'sec-fetch-site': 'cross-site' } }), 403);
  assert.equal(pedir({ headers: { origin: 'https://ataque.com' } }), 'pasa'); // GET: sin CORS, esa página no puede leer la respuesta
});

test('la CSP permite justo los scripts escritos en los HTML', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const [, mapa] = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  const hashes = hashesDeScripts(path.join(__dirname, '../public'));
  assert.ok(hashes.includes(`'sha256-${crypto.createHash('sha256').update(mapa).digest('base64')}'`));
  assert.equal(hashes.length, 2); // el mapa de three.js y el de whatsapp.html; app.js va con src
});

test('los agentes no alcanzan otras tablas, ni tras una coma', () => {
  const { revisarSQL } = require('../src/integraciones/agentes/agentes');
  const notas = ['notas'];
  assert.equal(revisarSQL('SELECT folio FROM notas', notas), null);
  assert.match(revisarSQL('SELECT * FROM notas, ajustes', notas), /ajustes/);
  assert.match(revisarSQL('SELECT * FROM notas WHERE id IN (SELECT id FROM clientes)', notas), /clientes/);
  assert.match(revisarSQL('SELECT * FROM sqlite_master', notas), /no permitida/);
  assert.match(revisarSQL('SELECT * FROM pragma_table_info(\'notas\')', notas), /no permitida/);
});

test('respaldo: copia fechada, sana y restaurable, con sus fotos', async () => {
  db.prepare(`INSERT INTO clientes (nombre) VALUES ('RESPALDADO')`).run();
  fs.mkdirSync(path.join(carpeta, 'fotos'), { recursive: true });
  fs.writeFileSync(path.join(carpeta, 'fotos', 'a.jpg'), 'foto');

  const dia = new Date(2026, 9, 30, 10, 0);
  const nombre = await respaldos.respaldar(dia);
  assert.equal(nombre, 'backup-2026-10-30.db');
  const copia = path.join(respaldos.CARPETA, nombre);
  assert.equal(respaldos.copiaSana(copia), true);
  assert.deepEqual(fs.readdirSync(respaldos.CARPETA).filter((a) => a.includes('.tmp')), []);
  for (const sobra of ['-wal', '-shm']) fs.rmSync(copia + sobra, { force: true });
  assert.equal(fs.readFileSync(path.join(respaldos.CARPETA, 'fotos', 'a.jpg'), 'utf8'), 'foto');

  const Database = require('better-sqlite3');
  const leida = new Database(copia, { readonly: true });
  assert.equal(leida.prepare(`SELECT COUNT(*) AS n FROM clientes WHERE nombre = 'RESPALDADO'`).get().n, 1);
  leida.close();

  // Dañada: no se acepta.
  const mala = path.join(carpeta, 'mala.db');
  fs.writeFileSync(mala, 'esto no es una base');
  assert.throws(() => respaldos.copiaSana(mala));
});

test('respaldo: cuándo toca', () => {
  const copia = path.join(respaldos.CARPETA, 'backup-2030-01-15.db');
  fs.writeFileSync(copia, 'x');
  assert.equal(respaldos.toca(new Date(2030, 0, 16, 9, 0)), true); // otro día, sin copia
  fs.utimesSync(copia, new Date(2030, 0, 15, 9, 0), new Date(2030, 0, 15, 9, 0));
  assert.equal(respaldos.toca(new Date(2030, 0, 15, 12, 0)), false); // ya hay de hoy, antes de la hora
  assert.equal(respaldos.toca(new Date(2030, 0, 15, 18, 1)), true); // pasó la hora: se renueva
  fs.utimesSync(copia, new Date(2030, 0, 15, 18, 1), new Date(2030, 0, 15, 18, 1));
  assert.equal(respaldos.toca(new Date(2030, 0, 15, 19, 0)), false); // ya se hizo
  fs.rmSync(copia);
});

test('se conservan las últimas 60 copias', async () => {
  for (let i = 1; i <= 62; i++) {
    const d = new Date(2020, 0, i);
    fs.writeFileSync(path.join(respaldos.CARPETA, `backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.db`), 'x');
  }
  await respaldos.respaldar(new Date(2026, 9, 31));
  const quedan = fs.readdirSync(respaldos.CARPETA).filter((a) => a.endsWith('.db'));
  assert.equal(quedan.length, 60);
  assert.ok(quedan.includes('backup-2026-10-31.db'));
  assert.ok(!quedan.includes('backup-2020-01-01.db'));
});
