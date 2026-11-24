// Conexión a WhatsApp como dispositivo vinculado del número del negocio (whatsapp-web.js).
// La vinculación se hace una vez escaneando el QR en /whatsapp.html y queda en data/whatsapp-sesion.
const fs = require('node:fs');
const path = require('node:path');
const { Client, LocalAuth, MessageMedia, Chat } = require('whatsapp-web.js');
const puppeteer = require('puppeteer');
const QRCode = require('qrcode');
const { whatsapp: config } = require('../../config');
const estado = require('../estado');
const ventanaWindows = require('./ventana-windows');

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
let chromePid = null; // el Chrome de la última conexión: los reintentos que fallan al abrir no tienen el suyo
let aProposito = false; // la Oficina misma está cerrando el navegador (reintento o apagado)
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
    aProposito = true;
    await cerrarChrome(cliente);
    conectar();
  }, ms);
}

// destroy() no siempre apaga Chrome: si la pestaña se cerró o se perdió la conexión, el proceso se queda vivo con el
// perfil apartado y cada reintento falla con "The browser is already running" (24-nov). Se mata el que quede.
function sigueVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function cerrarChrome(anterior) {
  const pid = anterior?.pupBrowser?.process?.()?.pid ?? chromePid;
  await anterior?.destroy().catch(() => {});
  if (!pid || !sigueVivo(pid)) return;
  console.error(`[whatsapp] Chrome anterior (pid ${pid}) seguía abierto; cerrándolo`);
  if (process.platform === 'win32') {
    await new Promise((listo) => require('node:child_process').execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => listo()));
  } else {
    try { process.kill(pid, 'SIGKILL'); } catch { /* ya no estaba */ }
  }
  chromePid = null;
  await new Promise((listo) => setTimeout(listo, 1500)); // que Windows suelte el perfil
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

// Chrome se apaga de golpe al reiniciar la Oficina: al volver "restaura" la pestaña de WhatsApp anterior y
// quedan dos peleándose la sesión ("WhatsApp está abierto en otra ventana", 17-nov). Se le borra esa memoria.
function olvidarPestanas() {
  const perfil = path.join(config.sesion, 'session', 'Default');
  try {
    fs.rmSync(path.join(perfil, 'Sessions'), { recursive: true, force: true });
    const archivo = path.join(perfil, 'Preferences');
    if (!fs.existsSync(archivo)) return;
    const prefs = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    prefs.profile = { ...prefs.profile, exit_type: 'Normal', exited_cleanly: true };
    prefs.session = { ...prefs.session, restore_on_startup: 5 }; // 5 = abrir sólo la página nueva
    fs.writeFileSync(archivo, JSON.stringify(prefs));
  } catch (err) {
    console.error('[whatsapp] no pude limpiar las pestañas anteriores:', err.message);
  }
}

function conectar() {
  listo = false;
  aProposito = false;
  olvidarPestanas();
  cliente = new Client({
    authStrategy: new LocalAuth({ dataPath: config.sesion }),
    webVersionCache: { type: 'local', path: config.cache },
    userAgent: agenteDeUsuario(),
    // Mismo Chrome que el robot de Pulpos: no se descarga otro.
    // Con ventana (escondida): el botón 💬 WhatsApp de la Oficina la muestra en esta PC.
    puppeteer: { headless: false, executablePath: puppeteer.executablePath(), args: ['--start-minimized', '--hide-crash-restore-bubble'] },
    evalOnNewDoc: noDejarCerrar,
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
    if (!este.escondida) { este.escondida = true; esconderVentana(este); } // que no estorbe al arrancar
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
    chromePid = este.pupBrowser?.process()?.pid ?? chromePid;
    protegerVentana(este).catch((err) => console.error('[whatsapp] ventana:', err.message));
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

// Mensajes que te escribieron en chats privados desde `desde` (segundos), del más viejo al más nuevo.
// Sirve para ponerse al día tras una noche apagada. La lista de chats se saca dentro de la página
// (getChats() de 1.34.7 falla con los grupos) y se usa fetchMessages sin pasar por getChatById.
async function mensajesDesde(desde, porChat = 40) {
  if (!listo) throw new Error('WhatsApp no está conectado');
  const ids = await cliente.pupPage.evaluate((d) => window.require('WAWebCollections').Chat.getModelsArray()
    .filter((c) => ['c.us', 'lid'].includes(c.id?.server) && (c.t ?? 0) >= d)
    .map((c) => c.id._serialized), desde);
  const todos = [];
  for (const id of ids) {
    try {
      const lista = await Chat.prototype.fetchMessages.call({ client: cliente, id: { _serialized: id } }, { limit: porChat, fromMe: false });
      todos.push(...lista.filter((m) => m.timestamp >= desde));
    } catch (err) {
      console.error(`[whatsapp] no pude leer el chat ${id}:`, err.message);
    }
  }
  return todos.sort((a, b) => a.timestamp - b.timestamp);
}

// ---- La ventana de WhatsApp de Chatito (sólo en esta PC) ----
// 'minimized' | 'normal'. Es la ventana de Chrome que tiene a WhatsApp.
async function ventana(estadoVentana) {
  const pagina = cliente?.pupPage;
  if (!pagina) return;
  const cdp = await pagina.target().createCDPSession();
  try {
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: estadoVentana } });
  } finally {
    await cdp.detach().catch(() => {});
  }
}

// La esconde del todo (ni en la barra de tareas); si Windows no deja, la minimiza.
async function esconderVentana(este) {
  try {
    este.hwnd ||= await ventanaWindows.buscar(este.pupBrowser?.process()?.pid);
    if (este.hwnd) return await ventanaWindows.esconder(este.hwnd);
  } catch (err) {
    console.error('[whatsapp] no pude esconder la ventana:', err.message);
  }
  await ventana('minimized').catch(() => {});
}

// La × no cierra la ventana: Chrome pregunta "¿salir?", la Oficina contesta que no y sólo la esconde.
// Este aviso corre en la página ANTES que WhatsApp y no le deja enterarse del intento: si se entera, corta su
// conexión y se queda en "WhatsApp está abierto en otra ventana" (17-nov).
function noDejarCerrar() {
  window.addEventListener('beforeunload', (e) => {
    e.stopImmediatePropagation();
    e.preventDefault();
    e.returnValue = '';
  });
}

// Si aun así se cierra (ej. desde el Administrador de tareas), Chatito la vuelve a abrir solo, sin QR.
async function protegerVentana(este) {
  const pagina = este.pupPage;
  if (!pagina || pagina.protegida) return;
  pagina.protegida = true;
  pagina.on('dialog', async (d) => {
    if (d.type() !== 'beforeunload') return;
    await d.dismiss().catch(() => {});
    esconderVentana(este);
  });
  const alCerrar = () => {
    if (este !== cliente || aProposito || !este.pupBrowser || este.cerrada) return;
    este.cerrada = true;
    console.error(`[whatsapp] ${horaLog()} se cerró la ventana de WhatsApp; abriéndola otra vez`);
    listo = false;
    estado.reportar(ORIGEN, false, 'Se cerró la ventana de WhatsApp; reconectando…');
    reconectarEn(3000);
  };
  pagina.on('close', alCerrar);
  este.pupBrowser.on('disconnected', alCerrar);
  // Chrome sólo pregunta antes de cerrar si alguien ya "tocó" la página: se toca con un Shift.
  const cdp = await pagina.target().createCDPSession();
  try {
    for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
  } finally {
    await cdp.detach().catch(() => {});
  }
}

// Trae al frente la ventana de WhatsApp; con teléfono, abre el chat de ese número. false si no tiene WhatsApp.
async function mostrarVentana(telefono) {
  if (!listo) throw Object.assign(new Error('WhatsApp no está conectado'), { status: 503 });
  if (cliente.hwnd) await ventanaWindows.mostrar(cliente.hwnd).catch((err) => console.error('[whatsapp] no pude mostrar la ventana:', err.message));
  await ventana('normal');
  await cliente.pupPage.bringToFront();
  if (!telefono) return true;
  const id = await cliente.getNumberId(String(telefono).replace(/\D/g, ''));
  if (!id) return false;
  await cliente.interface.openChatWindow(id._serialized);
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
  aProposito = true;
  await cliente?.destroy().catch(() => {});
}

module.exports = {
  iniciar,
  detener,
  enviar,
  enviarImagen,
  enviarImagenAGrupo,
  mensajesDesde,
  mostrarVentana,
  estaListo: () => listo,
  alConectar: (fn) => alConectar.push(fn),
  alMensaje: (fn) => alMensaje.push(fn),
  alPropio: (fn) => alPropio.push(fn),
  qrSvg: () => (qrActual ? QRCode.toString(qrActual, { type: 'svg', margin: 1 }) : Promise.resolve(null)),
};
