// Grupo del equipo en WhatsApp ("AGENTES IA CHAT"): el mensaje que nombra a un agente lo atiende
// sólo ése, y contesta en el grupo. Sin nombre no contesta nadie. Los demás grupos se ignoran.
// Edgar anota cargas de combustible (combustible.js); Chatito deja cotizaciones por autorizar; lo demás son preguntas.
const { whatsapp: config } = require('../../config');
const agentes = require('./agentes');
const solicitudes = require('../inspector/solicitudes');
const evidencias = require('../sulema/evidencias');
const combustible = require('./combustible');
const octavio = require('../octavio/grupo');
const bus = require('../../events/bus');
const { generarTarjetaPNG } = require('../inspector/imagen');

const PIDE_AUTORIZACION = 'Así quedó la cotización en la Oficina. ¿Me autorizas enviarla?';
const FOTO_RECIBIDA = 'Claro, te la dejo en la Oficina Virtual.';

const MAX_ATRASO_S = 300; // al reconectar llegan mensajes viejos: a esos no se les contesta
// No mensaje.reply(): cita con id._serialized, que en 1.34.7 llega vacío. Se manda al grupo sin citar.
const contestar = (mensaje, texto) => mensaje.client.sendMessage(mensaje.from, texto, { sendSeen: false });

const limpio = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const NOMBRES = [['edgar', 'rutas'], ['chatito', 'inspector'], ['sulema', 'chasis'], ['octavio', 'octavio']];

// El agente nombrado primero en el mensaje; null si no nombra a ninguno.
function agenteDe(texto) {
  const t = limpio(texto);
  const hallados = NOMBRES.map(([nombre, id]) => ({ id, en: t.search(new RegExp(`\\b${nombre}\\b`)) })).filter((h) => h.en >= 0);
  return hallados.sort((a, b) => a.en - b.en)[0]?.id ?? null;
}

async function atender(id, texto, { clave, persona, reporto }) {
  if (id === 'rutas' && combustible.esCombustible(texto)) {
    const anotado = await combustible.anotar(texto, reporto, persona);
    if (anotado) return anotado;
  }
  if (id === 'inspector' && solicitudes.pideCotizacion(texto)) {
    const { cliente: nombre, renglones } = await solicitudes.cotizacionDelGrupo(clave, texto);
    return `Listo, la dejé por autorizar en la Oficina: ${nombre}${renglones ? `, ${renglones} material(es)` : ', sin materiales: complétalos ahí'}.`;
  }
  return agentes.preguntar(id, `${reporto ? `${reporto} en el grupo: ` : ''}${texto}`);
}

// mensaje.getChat() de whatsapp-web.js 1.34.7 falla con los grupos (error "r" al armar el chat);
// el nombre se lee directo del chat dentro de la página, sin armarlo.
function nombreEnPagina(id) {
  const chat = window.require('WAWebCollections').Chat.get(window.require('WAWebWidFactory').createWid(id));
  return chat?.formattedTitle ?? chat?.name ?? chat?.groupMetadata?.subject ?? null;
}
const nombreDelGrupo = (mensaje) => mensaje.getChat().then((c) => c.name)
  .catch(() => mensaje.client.pupPage.evaluate(nombreEnPagina, mensaje.from));

const nombresDeGrupo = new Map(); // id del grupo -> nombre, para no pedirlo en cada mensaje
async function esElGrupo(mensaje) {
  if (!mensaje.from?.endsWith('@g.us')) return false;
  if (!nombresDeGrupo.has(mensaje.from)) nombresDeGrupo.set(mensaje.from, await nombreDelGrupo(mensaje));
  return limpio(nombresDeGrupo.get(mensaje.from)).trim() === limpio(config.grupoAgentes).trim();
}

async function procesarMensaje(mensaje) {
  const esFoto = mensaje.type === 'image';
  if (mensaje.fromMe || !(esFoto || mensaje.type === 'chat')) return;
  if (mensaje.timestamp && Date.now() / 1000 - mensaje.timestamp > MAX_ATRASO_S) return;
  const texto = String(mensaje.body ?? '').trim();
  const id = agenteDe(texto);
  if (!(await esElGrupo(mensaje))) return;
  const contacto = await mensaje.getContact().catch(() => null);
  const reporto = contacto?.pushname || contacto?.name || null;
  // Foto de nota firmada para Sulema; cada quien del grupo lleva su propia ventana de 5 minutos.
  const clave = `${mensaje.from}|${mensaje.author ?? ''}`;
  if (await evidencias.recibir(mensaje, { clave, texto, esFoto, envio: reporto })) return;
  // "sí" / "no" a Edgar: "¿Lo registro como retiro en la Caja de Pulpos?"
  if (!esFoto && combustible.esperaRespuesta(clave, texto)) {
    await contestar(mensaje, await combustible.responder(clave, texto));
    return;
  }
  // Octavio: "Octavio, mándame este material…" y las respuestas a su "¿Así está bien?" (si no nombran a otro agente).
  if (!esFoto && (id === 'octavio' || !id) && octavio.leToca(clave, texto)) {
    let respuesta;
    try {
      respuesta = await octavio.atender(mensaje, { clave, texto, reporto });
    } catch (err) {
      console.error('[grupo] octavio:', err.message);
      respuesta = 'No pude armar la orden ahorita; intenta de nuevo en un momento.';
    }
    if (respuesta) await contestar(mensaje, respuesta);
    return;
  }
  // Foto de una lista con "Chatito" en el pie: contesta al momento y luego lee la foto y arma la tarjeta.
  if (esFoto && id === 'inspector') {
    await contestar(mensaje, FOTO_RECIBIDA);
    await solicitudes.cotizacionDeFotoGrupo(mensaje, mensaje.from, texto).catch(async (err) => {
      console.error('[grupo] foto para Chatito:', err.message);
      await contestar(mensaje, 'No pude leer la foto; captúrala a mano en la Oficina.');
    });
    return;
  }
  if (!id || esFoto) return;
  let respuesta;
  try {
    respuesta = await atender(id, texto, { clave: mensaje.from, persona: clave, reporto });
  } catch (err) {
    console.error(`[grupo] ${id}:`, err.message);
    respuesta = 'No pude atender eso ahorita; intenta de nuevo en un momento.';
  }
  await contestar(mensaje, respuesta);
}

// Escrito desde el WhatsApp de la Oficina ("Mat Güero"): sólo Edgar con combustible, y el sí/no a su pregunta.
// Tiene que EMPEZAR con "Edgar": así nunca se contesta a sí mismo (sus respuestas no empiezan así).
async function procesarPropio(mensaje) {
  if (!mensaje.fromMe || mensaje.type !== 'chat') return;
  if (mensaje.timestamp && Date.now() / 1000 - mensaje.timestamp > MAX_ATRASO_S) return;
  const chat = mensaje.to;
  if (!chat || chat.endsWith('@broadcast') || chat.endsWith('@newsletter')) return;
  const texto = String(mensaje.body ?? '').trim();
  const clave = `propio|${chat}`;
  const enviar = (t) => mensaje.client.sendMessage(chat, t, { sendSeen: false });
  const respuesta = combustible.esperaRespuesta(clave, texto);
  const esCarga = !respuesta && /^edgar\b/.test(limpio(texto)) && combustible.esCombustible(texto);
  if (!respuesta && !esCarga) return;
  if (chat.endsWith('@g.us') && !(await esElGrupo({ from: chat, getChat: () => mensaje.getChat(), client: mensaje.client }))) return;
  if (respuesta) return enviar(await combustible.responder(clave, texto));
  try {
    const r = await combustible.anotar(texto, 'Oficina (WhatsApp)', clave);
    if (r) await enviar(r);
  } catch (err) {
    console.error('[grupo] edgar (Oficina):', err.message);
    await enviar('No pude anotar la carga ahorita; intenta de nuevo en un momento.');
  }
}

// Uno a la vez, como los mensajes de clientes.
// Chatito armó una tarjeta con la foto de un cliente: manda al grupo la imagen de la tarjeta.
// Sólo avisa; se autoriza (y se envía al cliente) desde la Oficina.
async function avisarTarjeta(whatsapp, id) {
  const s = solicitudes.obtener(id);
  if (!s || !whatsapp.estaListo()) return;
  const png = await generarTarjetaPNG({ ...s, borrador: JSON.parse(s.borrador) });
  if (!(await whatsapp.enviarImagenAGrupo(config.grupoAgentes, png, `tarjeta-${id}.png`, PIDE_AUTORIZACION))) {
    console.error(`[grupo] no encontré el grupo "${config.grupoAgentes}" para avisar la tarjeta #${id}`);
  }
}

function iniciar(whatsapp) {
  bus.on('solicitud:foto', (id) => avisarTarjeta(whatsapp, id).catch((err) => console.error('[grupo] tarjeta:', err.message)));
  let cola = Promise.resolve();
  whatsapp.alMensaje((m) => {
    cola = cola.then(() => procesarMensaje(m)).catch((err) => console.error('[grupo] WhatsApp:', err.message));
  });
  whatsapp.alPropio?.((m) => {
    cola = cola.then(() => procesarPropio(m)).catch((err) => console.error('[grupo] WhatsApp (Oficina):', err.message));
  });
}

module.exports = { iniciar, procesarMensaje, procesarPropio, agenteDe, avisarTarjeta, PIDE_AUTORIZACION, FOTO_RECIBIDA };
