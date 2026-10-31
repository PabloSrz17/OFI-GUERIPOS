// PIN de entrada a la Oficina. Sólo se guarda su huella (scrypt), nunca el PIN. Al entrar, el navegador
// recibe una sesión de 30 días en una cookie que JavaScript no puede leer; en la base sólo está su hash.
// El PIN se crea desde esta PC, para que nadie de la red lo ponga primero.
const crypto = require('node:crypto');
const express = require('express');
const db = require('../db/connection');
const { esEstaPC } = require('./seguridad');

const COOKIE = 'oficina_sesion';
const DURACION_S = 30 * 24 * 60 * 60;
const MAX_FALLOS = 5;
const BLOQUEO_MS = 5 * 60_000;
// Lo único que se ve sin haber entrado: la pantalla del PIN.
const ABIERTO = new Set(['/login.html', '/css/styles.css', '/js/login.js', '/api/health']);

db.exec('CREATE TABLE IF NOT EXISTS sesiones (hash TEXT PRIMARY KEY, expira INTEGER NOT NULL)');

const stmts = {
  pin: db.prepare(`SELECT valor FROM ajustes WHERE clave = 'pin_huella'`),
  guardarPin: db.prepare(`INSERT INTO ajustes (clave, valor) VALUES ('pin_huella', ?)`),
  borrarPin: db.prepare(`DELETE FROM ajustes WHERE clave = 'pin_huella'`),
  crearSesion: db.prepare('INSERT INTO sesiones (hash, expira) VALUES (?, ?)'),
  sesion: db.prepare('SELECT 1 FROM sesiones WHERE hash = ? AND expira > ?'),
  salir: db.prepare('DELETE FROM sesiones WHERE hash = ?'),
  vencidas: db.prepare('DELETE FROM sesiones WHERE expira <= ?'),
  todas: db.prepare('DELETE FROM sesiones'),
};

const huella = (pin, sal) => crypto.scryptSync(pin, sal, 32).toString('hex');
const hashSesion = (token) => crypto.createHash('sha256').update(token).digest('hex');
const ahoraS = () => Math.floor(Date.now() / 1000);

function pinCorrecto(pin) {
  const guardado = stmts.pin.get()?.valor;
  if (!guardado) return false;
  const [sal, esperado] = guardado.split(':');
  return crypto.timingSafeEqual(Buffer.from(huella(pin, sal), 'hex'), Buffer.from(esperado, 'hex'));
}

// 6 a 12 dígitos, sin los más fáciles de adivinar. Devuelve el motivo si no sirve.
function problemaDelPin(pin) {
  if (!/^\d{6,12}$/.test(pin)) return 'El PIN debe tener de 6 a 12 números';
  if (/^(\d)\1+$/.test(pin) || '01234567890123'.includes(pin) || '98765432109876'.includes(pin)) return 'Ese PIN es muy fácil de adivinar';
  return null;
}

function leerCookie(req) {
  for (const parte of String(req.headers.cookie ?? '').split(';')) {
    const [nombre, valor] = parte.trim().split('=');
    if (nombre === COOKIE) return valor;
  }
  return null;
}

const sesionValida = (req) => {
  const token = leerCookie(req);
  return Boolean(token && stmts.sesion.get(hashSesion(token), ahoraS()));
};

function abrirSesion(res) {
  const token = crypto.randomBytes(32).toString('hex');
  stmts.crearSesion.run(hashSesion(token), ahoraS() + DURACION_S);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DURACION_S}`);
}

// Intentos fallidos por dirección, para que no se pueda probar PIN tras PIN.
const fallos = new Map();
const direccion = (req) => req.socket.remoteAddress ?? '';

const router = express.Router();

router.get('/estado', (req, res) => {
  res.json({ hayPin: Boolean(stmts.pin.get()), puedeCrear: esEstaPC(req), dentro: sesionValida(req) });
});

router.post('/crear', (req, res) => {
  if (stmts.pin.get()) return res.status(409).json({ error: 'Ya hay un PIN' });
  if (!esEstaPC(req)) return res.status(403).json({ error: 'El PIN se crea en la PC principal' });
  const pin = String(req.body?.pin ?? '');
  const problema = problemaDelPin(pin);
  if (problema) return res.status(400).json({ error: problema });
  const sal = crypto.randomBytes(16).toString('hex');
  stmts.guardarPin.run(`${sal}:${huella(pin, sal)}`);
  abrirSesion(res);
  return res.status(201).json({ ok: true });
});

router.post('/entrar', (req, res) => {
  const f = fallos.get(direccion(req));
  if (f && f.hasta > Date.now()) {
    return res.status(429).json({ error: `Demasiados intentos. Espera ${Math.ceil((f.hasta - Date.now()) / 60_000)} min.` });
  }
  if (!pinCorrecto(String(req.body?.pin ?? ''))) {
    const veces = (f && f.hasta === 0 ? f.veces : 0) + 1;
    fallos.set(direccion(req), veces >= MAX_FALLOS ? { veces: 0, hasta: Date.now() + BLOQUEO_MS } : { veces, hasta: 0 });
    return res.status(401).json({ error: 'PIN incorrecto' });
  }
  fallos.delete(direccion(req));
  abrirSesion(res);
  return res.json({ ok: true });
});

router.post('/salir', (req, res) => {
  const token = leerCookie(req);
  if (token) stmts.salir.run(hashSesion(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

function proteger(req, res, next) {
  if (ABIERTO.has(req.path) || sesionValida(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Falta entrar con el PIN', pin: true });
  if (req.path === '/' || req.path.endsWith('.html')) return res.redirect('/login.html');
  return res.status(401).end();
}

function borrarPin() {
  stmts.borrarPin.run();
  stmts.todas.run();
}

stmts.vencidas.run(ahoraS());

module.exports = { router, proteger, borrarPin, problemaDelPin };
