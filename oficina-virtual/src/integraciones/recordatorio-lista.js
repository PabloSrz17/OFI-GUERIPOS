// Recordatorio de pase de lista: de lunes a sábado a las 10:00 avisa a las pantallas abiertas.
// El globo se calcula en /api/resumen, así que también lo ve quien abra la Oficina más tarde.
const asistencias = require('../repositories/asistencias.repo');
const bus = require('../events/bus');

const CADA_MS = 15_000;
let avisadoEl = null;

function iniciar() {
  setInterval(() => {
    const hoy = new Date().toDateString();
    if (avisadoEl === hoy || !asistencias.pendienteHoy()) return;
    avisadoEl = hoy;
    bus.emit('asistencia:cambio');
  }, CADA_MS);
}

module.exports = { iniciar };
