// Recordatorio a las 24 horas de enviar una cotización, si no se marcó Pagada ni Cerrada. Todo vive
// en SQLite, así que sobrevive reinicios; si la PC estaba apagada, sale al volver a conectar.
const cotizaciones = require('../../repositories/cotizaciones.repo');
const whatsapp = require('../whatsapp/cliente');
const { seguimiento } = require('../whatsapp/mensajes');
const bus = require('../../events/bus');

const CADA_MS = 60_000;
let corriendo = false;

async function revisar(cliente = whatsapp) {
  if (corriendo || !cliente.estaListo()) return;
  corriendo = true;
  try {
    for (const { id, telefono } of cotizaciones.seguimientosVencidos()) {
      let estado = 'error';
      try {
        estado = (await cliente.enviar(telefono, seguimiento())) ? 'enviado' : 'no_whatsapp';
        console.log(`[inspector] seguimiento de cotización ${id}: ${estado}`);
      } catch (err) {
        console.error(`[inspector] seguimiento de cotización ${id}:`, err.message);
      }
      cotizaciones.marcarSeguimiento(id, estado); // un error no se reintenta: mejor no mandarlo dos veces
      bus.emit('solicitud:nueva');
    }
  } finally {
    corriendo = false;
  }
}

function iniciar() {
  setInterval(() => revisar().catch((err) => console.error('[inspector] seguimiento:', err.message)), CADA_MS);
}

module.exports = { iniciar, revisar };
