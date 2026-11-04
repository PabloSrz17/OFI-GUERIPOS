// Avisos a tu celular cuando algo se cae. Por WhatsApp no sirve: es justo lo que se cae.
// 1) WhatsApp sin conectar más de AVISOS_MINUTOS (10): notificación por ntfy (app gratis, sin cuenta;
//    AVISOS_NTFY = https://ntfy.sh/<tema>). Otra cuando vuelve. Sólo el aviso, sin datos de clientes.
// 2) La Oficina apagada o la PC sin luz no puede avisar sola: cada 5 min "late" a AVISOS_LATIDO_URL
//    (healthchecks.io, gratis); si deja de latir, ese servicio te avisa por correo o a la app.
const estado = require('./estado');

const config = {
  ntfy: process.env.AVISOS_NTFY || '',
  latido: process.env.AVISOS_LATIDO_URL || '',
  minutos: Number(process.env.AVISOS_MINUTOS) || 10,
};
const REVISAR_MS = 60_000;
const LATIDO_MS = 5 * 60_000;

let caidoDesde = null; // primera vez que se vio sin conectar
let avisado = false;

async function notificar(titulo, texto, enviar = fetch) {
  if (!config.ntfy) return;
  try {
    // Los encabezados no llevan acentos tal cual: el título va codificado (RFC 2047, ntfy lo entiende).
    const title = `=?UTF-8?B?${Buffer.from(titulo).toString('base64')}?=`;
    await enviar(config.ntfy, { method: 'POST', body: texto, headers: { Title: title, Tags: 'office' } });
  } catch (err) {
    console.error('[avisos] no se pudo mandar al celular:', err.message);
  }
}

// Una revisión; ahora y enviar se pasan en las pruebas.
async function revisar(ahora = Date.now(), enviar = fetch) {
  const w = estado.obtener().whatsapp;
  if (!w || w.ok === null) return; // desactivado
  if (w.ok) {
    if (avisado) await notificar('WhatsApp volvió', '✅ WhatsApp de la Oficina ya está conectado otra vez.', enviar);
    caidoDesde = null;
    avisado = false;
    return;
  }
  caidoDesde ??= ahora;
  if (!avisado && ahora - caidoDesde >= config.minutos * 60_000) {
    avisado = true;
    await notificar('WhatsApp sin conectar', `⚠️ WhatsApp de la Oficina lleva ${config.minutos} min sin conectar: ${w.mensaje}`, enviar);
  }
}

function latir() {
  if (config.latido) fetch(config.latido).catch((err) => console.error('[avisos] latido:', err.message));
}

function iniciar() {
  if (!config.ntfy && !config.latido) return;
  setInterval(() => revisar().catch(() => {}), REVISAR_MS).unref();
  latir();
  setInterval(latir, LATIDO_MS).unref();
  console.log(`[avisos] al celular:${config.ntfy ? ' WhatsApp caído' : ''}${config.latido ? ' + latido' : ''}`);
}

module.exports = { iniciar, revisar, config, notificar };
