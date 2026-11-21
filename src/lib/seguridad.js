// Defensas del servidor local. La Oficina no recibe webhooks ni usa túneles: WhatsApp, Pulpos y Sheets
// salen desde aquí hacia afuera, así que nadie de internet necesita entrar. Por eso sólo se atiende a
// esta PC y a la red local. No hay encabezados CORS a propósito: otras páginas no pueden leer la API.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// La IP completa: "192.168.1.5.ataque.com" empieza igual, pero es un dominio de internet.
const esIpLocal = (ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(ip);

// "::ffff:192.168.1.5" -> "192.168.1.5"
function esClienteLocal(direccion) {
  const ip = String(direccion ?? '').replace(/^::ffff:/, '');
  return ip === '::1' || /^f[cd]|^fe80/i.test(ip) || esIpLocal(ip);
}

// Nombre con el que se pidió la página. Un dominio de internet con punto se rechaza: así una página
// maliciosa no puede apuntar su dominio a esta PC, ni un túnel exponer el puerto.
function esHostLocal(host) {
  const nombre = String(host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!nombre) return false;
  return nombre === '::1' || nombre.endsWith('.local') || esIpLocal(nombre) || /^[a-z0-9-]+$/.test(nombre);
}

// Lo que cambia datos sólo se acepta desde la propia Oficina, no desde otra página abierta en el navegador.
function esMismoOrigen(req) {
  const origen = req.headers.origin;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!origen) return true; // no viene de un navegador
  try {
    return new URL(origen).host === req.headers.host;
  } catch {
    return false;
  }
}

function soloRedLocal(req, res, next) {
  if (!esClienteLocal(req.socket.remoteAddress) || !esHostLocal(req.headers.host)) {
    return res.status(403).json({ error: 'Sólo disponible en la red local' });
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !esMismoOrigen(req)) {
    return res.status(403).json({ error: 'Origen no permitido' });
  }
  return next();
}

// Hash de los <script> escritos dentro de los HTML (el mapa de three.js y el de whatsapp.html): la CSP
// los permite a ellos y a ningún otro script insertado.
function hashesDeScripts(carpeta) {
  const hashes = new Set();
  for (const archivo of fs.readdirSync(carpeta).filter((a) => a.endsWith('.html'))) {
    // El navegador lee los saltos de línea de Windows (\r\n) como \n: el hash debe ser del mismo texto.
    const html = fs.readFileSync(path.join(carpeta, archivo), 'utf8').replace(/\r\n?/g, '\n');
    for (const [, codigo] of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      hashes.add(`'sha256-${crypto.createHash('sha256').update(codigo).digest('base64')}'`);
    }
  }
  return [...hashes];
}

function encabezados(carpetaPublica) {
  const csp = [
    "default-src 'self'",
    // wasm-unsafe-eval y el worker: el OCR de tickets corre en WebAssembly. Sólo con archivos de aquí mismo.
    `script-src 'self' 'wasm-unsafe-eval' ${hashesDeScripts(carpetaPublica).join(' ')}`,
    "worker-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return (req, res, next) => {
    res.set({
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    next();
  };
}

const esEstaPC = (req) => /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress ?? '');

module.exports = { soloRedLocal, encabezados, esClienteLocal, esHostLocal, esMismoOrigen, esEstaPC, hashesDeScripts };
