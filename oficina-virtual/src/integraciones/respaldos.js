// Copias de seguridad de la base y las fotos en data/respaldos/: backup-AAAA-MM-DD.db. Se hacen al
// arrancar si hoy no hay copia, al llegar la hora programada y en cada Cierre de Jornada. Del mismo
// día queda sólo la más reciente; se conservan las últimas 60. Cada copia se revisa antes de aceptarla.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const db = require('../db/connection');
const estado = require('./estado');
const { dbPath, respaldos: config } = require('../config');

const ORIGEN = 'respaldos';
const DATOS = path.dirname(dbPath);
const CARPETA = path.join(DATOS, 'respaldos');
const FOTOS = path.join(DATOS, 'fotos');
const MAX_COPIAS = 60;

const dos = (n) => String(n).padStart(2, '0');
const nombreDe = (d) => `backup-${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}.db`;
const copias = () => fs.readdirSync(CARPETA).filter((a) => /^backup-\d{4}-\d{2}-\d{2}\.db$/.test(a)).sort();

function copiaSana(archivo) {
  const prueba = new Database(archivo, { readonly: true, fileMustExist: true });
  try {
    return prueba.pragma('integrity_check', { simple: true }) === 'ok';
  } finally {
    prueba.close();
  }
}

let enCurso = null;

// Usa la copia en línea de SQLite: es segura aunque la Oficina esté trabajando.
async function hacer(ahora) {
  fs.mkdirSync(CARPETA, { recursive: true });
  const nombre = nombreDe(ahora);
  const temporal = path.join(CARPETA, `${nombre}.tmp`);
  await db.backup(temporal);
  const sana = copiaSana(temporal);
  for (const sobra of ['-wal', '-shm']) fs.rmSync(temporal + sobra, { force: true }); // los deja al abrirla
  if (!sana) {
    fs.rmSync(temporal, { force: true });
    throw new Error('la copia salió dañada');
  }
  fs.renameSync(temporal, path.join(CARPETA, nombre));
  // Las fotos no cambian: sólo se agregan las nuevas.
  if (fs.existsSync(FOTOS)) fs.cpSync(FOTOS, path.join(CARPETA, 'fotos'), { recursive: true, force: false });
  for (const vieja of copias().slice(0, -MAX_COPIAS)) fs.rmSync(path.join(CARPETA, vieja));
  estado.reportar(ORIGEN, true, `Último: ${nombre} · ${ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`);
  console.log(`[respaldos] ${nombre}`);
  return nombre;
}

// Devuelve el nombre de la copia. Falla con error, pero avisa en la barra superior.
async function respaldar(ahora = new Date()) {
  enCurso ??= hacer(ahora)
    .catch((err) => {
      estado.reportar(ORIGEN, false, `No pude respaldar: ${err.message}`);
      console.error('[respaldos]', err.message);
      throw err;
    })
    .finally(() => { enCurso = null; });
  return enCurso;
}

// ¿Toca copia? Al arrancar, si hoy no hay; después, una vez pasada la hora programada.
function toca(ahora) {
  const archivo = path.join(CARPETA, nombreDe(ahora));
  if (!fs.existsSync(archivo)) return true;
  const programada = new Date(ahora);
  programada.setHours(config.hora, 0, 0, 0);
  return ahora >= programada && fs.statSync(archivo).mtime < programada;
}

function revisar() {
  if (toca(new Date())) respaldar().catch(() => {}); // el aviso ya quedó en la barra
}

function iniciar() {
  estado.reportar(ORIGEN, null, 'Sin respaldos todavía');
  revisar();
  setInterval(revisar, 60_000).unref();
}

module.exports = { iniciar, respaldar, toca, copiaSana, CARPETA };
