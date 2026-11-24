// Regla de 6 meses: las fotos de evidencia de los últimos 6 meses (más el mes en curso) se quedan
// sueltas; cada mes anterior se empaqueta en data/evidencias/paquetes/AAAA/AAAA-MM_Mes.zip y su
// carpeta se borra sólo cuando el .zip quedó completo. Corre al arrancar y una vez al día.
const fs = require('node:fs');
const path = require('node:path');
const archiver = require('archiver');
const db = require('../../db/connection');
const { CARPETA } = require('./evidencias');

const MESES_SUELTOS = 6;
const UN_DIA = 24 * 60 * 60_000;

const marcar = db.prepare(`UPDATE evidencias SET paquete = ? WHERE archivo LIKE ? || '/%'`);

// Carpetas de mes ("2026-04_Abril") anteriores al corte, de la más vieja a la más nueva.
function mesesViejos(hoy = new Date()) {
  const corte = new Date(hoy.getFullYear(), hoy.getMonth() - MESES_SUELTOS, 1);
  const clave = `${corte.getFullYear()}-${String(corte.getMonth() + 1).padStart(2, '0')}`;
  if (!fs.existsSync(CARPETA)) return [];
  return fs.readdirSync(CARPETA, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}_/.test(d.name) && d.name.slice(0, 7) < clave)
    .map((d) => d.name)
    .sort();
}

function comprimir(carpeta, destino) {
  return new Promise((listo, falla) => {
    const salida = fs.createWriteStream(destino);
    const zip = archiver('zip', { zlib: { level: 6 } });
    salida.on('close', listo);
    zip.on('error', falla);
    zip.pipe(salida);
    zip.directory(carpeta, false);
    zip.finalize();
  });
}

async function empaquetar(hoy = new Date()) {
  const hechos = [];
  for (const mes of mesesViejos(hoy)) {
    const relativo = `paquetes/${mes.slice(0, 4)}/${mes}.zip`;
    const destino = path.join(CARPETA, relativo);
    if (fs.existsSync(destino)) {
      console.error(`[sulema] ${relativo} ya existe: la carpeta ${mes} se deja como está`);
      continue;
    }
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    const temporal = `${destino}.tmp`;
    await comprimir(path.join(CARPETA, mes), temporal);
    fs.renameSync(temporal, destino);
    marcar.run(relativo, mes);
    fs.rmSync(path.join(CARPETA, mes), { recursive: true, force: true });
    console.log(`[sulema] evidencias de ${mes} empaquetadas en ${relativo}`);
    hechos.push(relativo);
  }
  return hechos;
}

function iniciar() {
  const correr = () => empaquetar().catch((err) => console.error('[sulema] empaquetar:', err.message));
  correr();
  setInterval(correr, UN_DIA).unref();
}

module.exports = { iniciar, empaquetar, mesesViejos };
