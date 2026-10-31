// Conexión a WhatsApp como dispositivo vinculado del número del negocio (whatsapp-web.js).
// La vinculación se hace una vez escaneando el QR en /whatsapp.html y queda en data/whatsapp-sesion.
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const puppeteer = require('puppeteer');
const QRCode = require('qrcode');
const { whatsapp: config } = require('../../config');
const estado = require('../estado');

const ORIGEN = 'whatsapp';
const hora = () => new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

let cliente = null;
let listo = false;
let qrActual = null;
let reintento = null;
let vigia = null;
const alConectar = [];
const alMensaje = [];

function reconectarEn(ms) {
  clearTimeout(reintento);
  reintento = setTimeout(async () => {
    await cliente?.destroy().catch(() => {});
    conectar();
  }, ms);
}

// La librería se presenta por defecto como Chrome 101 de Mac y WhatsApp rechaza vincular
// navegadores tan viejos; se usa la identidad del Chrome real que corre (148, Windows).
function agenteDeUsuario() {
  const version = puppeteer.executablePath().match(/win64-(\d+)\./)?.[1] ?? '148';
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`;
}

// whatsapp-web.js 1.34.7 falla al enviar imágenes ("Data passed to getter must include an id
// property"): el modelo de la imagen trae la propiedad interna __x_id y, al copiarse al mensaje,
// pisa su id. Arreglo oficial pendiente de publicar: https://github.com/wwebjs/whatsapp-web.js/pull/201923
// Aquí se aplica en memoria, dentro de la página de WhatsApp (no se modifican archivos de la
// librería): __x_id se vuelve no enumerable y ya no se copia. Se reaplica en cada conexión.
async function corregirEnvioDeImagenes() {
  await cliente.pupPage.evaluate(() => {
    if (window.WWebJS.__imagenesCorregidas) return;
    const original = window.WWebJS.processMediaData;
    window.WWebJS.processMediaData = async (...args) => {
      const datos = await original(...args);
      if (datos && Object.prototype.propertyIsEnumerable.call(datos, '__x_id')) {
        Object.defineProperty(datos, '__x_id', { enumerable: false });
      }
      return datos;
    };
    window.WWebJS.__imagenesCorregidas = true;
  });
}

function conectar() {
  listo = false;
  cliente = new Client({
    authStrategy: new LocalAuth({ dataPath: config.sesion }),
    webVersionCache: { type: 'local', path: config.cache },
    userAgent: agenteDeUsuario(),
    // Mismo Chrome que el robot de Pulpos: no se descarga otro.
    puppeteer: { headless: true, executablePath: puppeteer.executablePath() },
  });

  cliente.on('qr', (qr) => {
    qrActual = qr;
    estado.reportar(ORIGEN, false, 'Falta vincular: abre /whatsapp.html y escanea el QR');
  });
  cliente.on('ready', async () => {
    const limite = new Promise((_, falla) => setTimeout(() => falla(new Error('tardó más de 15 s')), 15_000));
    await Promise.race([corregirEnvioDeImagenes(), limite])
      .catch((err) => console.error('[whatsapp] arreglo de imágenes:', err.message));
    qrActual = null;
    listo = true;
    estado.reportar(ORIGEN, true, `Conectado · ${hora()}`);
    console.log('[whatsapp] conectado');
    alConectar.forEach((fn) => fn());
  });
  // Mensajes entrantes (sólo los que te escriben, no los que mandas tú).
  cliente.on('message', (mensaje) => alMensaje.forEach((fn) => fn(mensaje)));
  cliente.on('auth_failure', () => {
    estado.reportar(ORIGEN, false, 'No se pudo vincular: vuelve a escanear el QR');
  });
  cliente.on('disconnected', (motivo) => {
    listo = false;
    estado.reportar(ORIGEN, false, `Desconectado (${motivo}); reintentando…`);
    console.error('[whatsapp] desconectado:', motivo);
    reconectarEn(30_000);
  });

  estado.reportar(ORIGEN, false, 'Conectando…');
  // A veces WhatsApp Web se queda cargando sin error: si en 2 min no conecta ni pide QR, se reintenta.
  clearTimeout(vigia);
  vigia = setTimeout(() => {
    if (listo || qrActual) return;
    estado.reportar(ORIGEN, false, 'WhatsApp tardó demasiado en abrir; reintentando…');
    console.error('[whatsapp] se quedó cargando; reintentando');
    reconectarEn(1000);
  }, 120_000);
  cliente.initialize().catch((err) => {
    estado.reportar(ORIGEN, false, `No pude abrir WhatsApp: ${err.message}`);
    console.error('[whatsapp]', err);
    reconectarEn(60_000);
  });
}

// Envía un mensaje. Devuelve false si ese número no tiene WhatsApp.
async function enviar(telefono, texto) {
  if (!listo) throw new Error('WhatsApp no está conectado');
  const id = await cliente.getNumberId(telefono);
  if (!id) return false;
  await cliente.sendMessage(id._serialized, texto);
  return true;
}

// Envía una imagen PNG con un texto al pie. Devuelve false si ese número no tiene WhatsApp.
async function enviarImagen(telefono, png, nombreArchivo, pie) {
  if (!listo) throw new Error('WhatsApp no está conectado');
  const id = await cliente.getNumberId(telefono);
  if (!id) return false;
  const imagen = new MessageMedia('image/png', png.toString('base64'), nombreArchivo);
  await cliente.sendMessage(id._serialized, imagen, { caption: pie });
  return true;
}

function iniciar() {
  if (!config.activo) {
    estado.reportar(ORIGEN, null, 'Desactivado (WHATSAPP_ACTIVO=true en .env)');
    return;
  }
  conectar();
}

async function detener() {
  clearTimeout(reintento);
  clearTimeout(vigia);
  await cliente?.destroy().catch(() => {});
}

module.exports = {
  iniciar,
  detener,
  enviar,
  enviarImagen,
  estaListo: () => listo,
  alConectar: (fn) => alConectar.push(fn),
  alMensaje: (fn) => alMensaje.push(fn),
  qrSvg: () => (qrActual ? QRCode.toString(qrActual, { type: 'svg', margin: 1 }) : Promise.resolve(null)),
};
