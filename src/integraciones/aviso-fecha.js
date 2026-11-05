// Un día antes de la fecha que dio el cliente: aviso al celular (ntfy) con los folios. En la Oficina
// lo dice Edgar con /api/resumen (fechas_manana). Lo ya avisado se guarda junto a la base, por día:
// un reinicio no lo repite y una nota programada más tarde ese mismo día sí avisa.
const fs = require('node:fs');
const path = require('node:path');
const { dbPath } = require('../config');
const notas = require('../repositories/notas.repo');
const { notificar } = require('./avisos-celular');

const CADA_MS = 60_000;
const DESDE_HORA = 8;
const archivo = path.join(path.dirname(dbPath), 'aviso-fecha.json');

const dos = (n) => String(n).padStart(2, '0');
const leer = () => { try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch { return {}; } };

// Una revisión; ahora y enviar se pasan en las pruebas. Devuelve los folios avisados (o null).
async function revisar(ahora = new Date(), enviar = fetch) {
  if (ahora.getHours() < DESDE_HORA) return null;
  const hoy = `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`;
  const previo = leer();
  const yaAvisadas = previo.dia === hoy ? previo.folios ?? [] : [];
  const folios = notas.conFechaManana().map((n) => n.folio).filter((f) => !yaAvisadas.includes(f));
  if (!folios.length) return null;
  fs.writeFileSync(archivo, JSON.stringify({ dia: hoy, folios: [...yaAvisadas, ...folios] }));
  const texto = folios.length === 1 ? `📅 Mañana toca entregar la nota ${folios[0]}` : `📅 Mañana toca entregar ${folios.length} notas: ${folios.join(', ')}`;
  await notificar('Edgar: entrega con fecha', texto, enviar);
  return folios;
}

function iniciar() {
  setInterval(() => revisar().catch((err) => console.error('[aviso-fecha]', err.message)), CADA_MS).unref();
}

module.exports = { iniciar, revisar };
