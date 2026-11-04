// "Esta nota es para mañana": un aviso al día (desde las 8:00) por las notas programadas para mañana.
// En la Oficina lo pinta Edgar con /api/resumen (programadas_manana); al celular va por ntfy sólo con
// los folios, sin datos de clientes. El día ya avisado se guarda junto a la base: un reinicio no repite.
const fs = require('node:fs');
const path = require('node:path');
const { dbPath } = require('../config');
const notas = require('../repositories/notas.repo');
const bus = require('../events/bus');
const { notificar } = require('./avisos-celular');

const CADA_MS = 60_000;
const DESDE_HORA = 8;
const archivo = path.join(path.dirname(dbPath), 'aviso-manana.txt');

const leer = () => { try { return fs.readFileSync(archivo, 'utf8').trim(); } catch { return ''; } };

// Una revisión; ahora y enviar se pasan en las pruebas. Devuelve los folios avisados (o null).
async function revisar(ahora = new Date(), enviar = fetch) {
  if (ahora.getHours() < DESDE_HORA) return null;
  const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
  if (leer() === hoy) return null;
  const folios = notas.foliosParaManana();
  if (!folios.length) return null;
  fs.writeFileSync(archivo, hoy);
  bus.emit('nota:asignada'); // las pantallas abiertas repintan a Edgar
  const cuantas = folios.length === 1 ? 'Esta nota es para mañana' : `Estas ${folios.length} notas son para mañana`;
  await notificar('Esta nota es para mañana', `📌 ${cuantas}: ${folios.join(', ')}`, enviar);
  return folios;
}

function iniciar() {
  setInterval(() => revisar().catch((err) => console.error('[aviso-mañana]', err.message)), CADA_MS).unref();
}

module.exports = { iniciar, revisar };
