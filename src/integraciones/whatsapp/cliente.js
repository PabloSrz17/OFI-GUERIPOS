// Conexión a WhatsApp como dispositivo vinculado del número del negocio (whatsapp-web.js).
// La vinculación se hace una vez escaneando el QR en /whatsapp.html y queda en data/whatsapp-sesion.
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const puppeteer = require('puppeteer');
const QRCode = require('qrcode');
const { whatsapp: config } = require('../../config');
const estado = require('../estado');

const ORIGEN = 'whatsapp';
const hora = () => new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
const horaLog = () => new Date().toLocaleTimeString('es-MX', { hour12: false });
const REVISAR_MS = 15_000;
const SIN_AVANCE_MS = 90_000;
// Ya en "abriendo chats" al 99–100%: el intento bueno conecta en 3–25 s; el trabado nunca conecta
// (el 03-nov se esperaron 3–4 min y nada). Pasados 40 s sin conectar, conviene reintentar ya.
const SIN_AVANCE_AL_FINAL_MS = 40_000;
const MAX_INTENTO_MS = 10 * 60_000;

let cliente = null;
let listo = false;
let qrActual = null;
let reintento = null;
let vigia = null;
let inicioIntento = 0;
let ultimoAvance = 0;
let alFinal = false; // sesión aceptada y carga al 99% o más
const alConectar = [];
const alMensaje = [];
const alPropio = []; // lo que se escribe desde el WhatsApp de la Oficina (o lo que ella misma manda)

// A veces WhatsApp Web se queda cargando sin error. Cada 15 s se revisa: si no conectó, no pide QR
// y lleva 90 s sin señal de avance, se reintenta (con avance, hasta 10 min en total). En los registros
// del 2026-11-03 el intento bueno conecta 8–25 s después de arrancar y el trabado se queda en
// "abriendo chats"; revisando cada 2 min, cada intento trabado costaba hasta 4 min.
function vigilar() {
  clearTimeout(vigia);
  vigia = setTimeout(() => {
    if (listo || qrActual) return;
    const avanza = Date.now() - Math.max(inicioIntento, ultimoAvance) < (alFinal ? SIN_AVANCE_AL_FINAL_MS : SIN_AVANCE_MS);
    if (avanza && Date.now() - inicioIntento < MAX_INTENTO_MS) {
      vigilar();
      return;
    }
    estado.reportar(ORIGEN, false, 'WhatsApp tardó demasiado en abrir; reintentando…');
    console.error(`[whatsapp] ${horaLog()} se quedó cargando${avanza ? ' más de 10 min' : ' sin avanzar'}; reintentando`);
    reconectarEn(1000);
  }, REVISAR_MS);
}

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
  // Al reintentar se destruye el cliente anterior y su initialize() falla (Target closed): ese error
  // ya no cuenta. Antes reprogramaba otra reconexión y tumbaba al cliente nuevo ya conectado (04-nov).
  const este = cliente;

  cliente.on('qr', (qr) => {
    qrActual = qr;
    estado.reportar(ORIGEN, false, 'Falta vincular: abre /whatsapp.html y escanea el QR');
  });
  // Señales de que sigue cargando: el vigilante no corta un intento que avanza.
  cliente.on('loading_screen', (porcentaje) => {
    if (este !== cliente) return;
    ultimoAvance = Date.now();
    if (Number(porcentaje) >= 99) alFinal = true;
    console.log(`[whatsapp] ${horaLog()} cargando ${porcentaje}%`);
  });
  cliente.on('authenticated', () => {
    ultimoAvance = Date.now();
    console.log(`[whatsapp] ${horaLog()} sesión aceptada, abriendo chats…`);
  });
  cliente.on('ready', async () => {
    const limite = new Promise((_, falla) => setTimeout(() => falla(new Error('tardó más de 15 s')), 15_000));
    await Promise.race([corregirEnvioDeImagenes(), limite])
      .catch((err) => console.error('[whatsapp] arreglo de imágenes:', err.message));
    qrActual = null;
    listo = true;
    estado.reportar(ORIGEN, true, `Conectado · ${hora()}`);
    console.log(`[whatsapp] conectado ${horaLog()}, a los ${Math.round((Date.now() - inicioIntento) / 1000)} s del intento`);
    alConectar.forEach((fn) => fn());
  });
  // Mensajes entrantes (sólo los que te escriben, no los que mandas tú).
  cliente.on('message', (mensaje) => alMensaje.forEach((fn) => fn(mensaje)));
  cliente.on('message_create', (mensaje) => { if (mensaje.fromMe) alPropio.forEach((fn) => fn(mensaje)); });
  cliente.on('auth_failure', () => {
    estado.reportar(ORIGEN, false, 'No se pudo vincular: vuelve a escanear el QR');
  });
  cliente.on('disconnected', (motivo) => {
    if (este !== cliente) return; // aviso del cliente anterior, ya destruido
    listo = false;
    estado.reportar(ORIGEN, false, `Desconectado (${motivo}); reintentando…`);
    console.error('[whatsapp] desconectado:', motivo);
    reconectarEn(30_000);
  });

  estado.reportar(ORIGEN, false, 'Conectando…');
  inicioIntento = Date.now();
  ultimoAvance = 0;
  alFinal = false;
  vigilar();
  cliente.initialize().catch((err) => {
    if (este !== cliente) return;
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

// Imagen a un grupo por su nombre (sin acentos ni mayúsculas). Devuelve false si no lo encuentra.
// El id se busca dentro de la página: getChats() de 1.34.7 falla con los grupos.
async function enviarImagenAGrupo(nombreGrupo, png, nombreArchivo, pie) {
  if (!listo) throw new Error('WhatsApp no está conectado');
  const id = await cliente.pupPage.evaluate((buscado) => {
    const limpio = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const chat = window.require('WAWebCollections').Chat.getModelsArray()
      .find((c) => c.id?.server === 'g.us' && limpio(c.formattedTitle ?? c.name ?? c.groupMetadata?.subject) === limpio(buscado));
    return chat?.id?._serialized ?? null;
  }, nombreGrupo);
  if (!id) return false;
  const imagen = new MessageMedia('image/png', png.toString('base64'), nombreArchivo);
  await cliente.sendMessage(id, imagen, { caption: pie, sendSeen: false });
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
  enviarImagenAGrupo,
  estaListo: () => listo,
  alConectar: (fn) => alConectar.push(fn),
  alMensaje: (fn) => alMensaje.push(fn),
  alPropio: (fn) => alPropio.push(fn),
  qrSvg: () => (qrActual ? QRCode.toString(qrActual, { type: 'svg', margin: 1 }) : Promise.resolve(null)),
};
