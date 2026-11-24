// Gasolina desde la Caja de Pulpos: los retiros de efectivo que dicen "gas nissan blanca", "diesel torton"…
// pasan solos al control de combustible de Edgar (y de ahí al Reporte semanal). Cada movimiento de Pulpos
// trae su id, así que nunca se anota dos veces. Sólo lee la Caja abierta: el robot pasa cada pocos minutos,
// mucho antes del corte.
// Si la misma carga (mismo día, unidad e importe) ya la reportaron por WhatsApp o a mano, no se duplica:
// se empareja con esa. Y si la reportan después de que entró de Pulpos, se empareja igual.
// Borrado en Pulpos: la Caja deja de mandar ese retiro (no trae marca). Sólo cuenta como borrado si en la
// Caja siguen movimientos anteriores a él; si no, pudo ser el corte de caja y no se toca nada.
const db = require('../../db/connection');

const limpio = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esCombustible = (texto) => /\b(gas|gasolina|diesel|disel|combustible|magna|premium)\b/.test(limpio(texto));

const REPORTO = 'Pulpos (caja)';
// Las mismas cargas pueden venir de la Caja del Punto de Venta nuevo (src/integraciones/pos). Sus ids llevan "pos:"
// y cada fuente sólo quita las suyas. El POS dice exactamente qué retiro se anuló, así que no hace falta adivinar.
const PULPOS = { reporto: REPORTO, prefijo: '', exacto: false, log: '[pulpos]' };
const POS = { reporto: 'Punto de Venta (caja)', prefijo: 'pos:', exacto: true, log: '[pos]' };
const DE_CAJA = new Set([PULPOS.reporto, POS.reporto]);
const esDe = (fuente, id) => (fuente.prefijo ? String(id).startsWith(fuente.prefijo) : !String(id).startsWith(POS.prefijo));

// Mismos nombres que el corcho de Edgar.
const UNIDADES = [
  { nombre: 'NISSAN BLANCA', es: /nissan\s*blanc|blanca/ },
  { nombre: 'NISSAN ROJA', es: /nissan\s*roj|roja/ },
  { nombre: 'RAM', es: /\bram\b/ },
  { nombre: 'FORD F450', es: /f\s*-?\s*450|\bford\b/ },
  { nombre: 'TORTON', es: /torton/ },
];

// "RAM 4000" y "ram" son la misma unidad; lo que no se reconoce se queda como lo escribieron.
const unidadCanonica = (texto) => UNIDADES.find((u) => u.es.test(limpio(texto)))?.nombre ?? String(texto ?? '').trim().toUpperCase();

const stmts = {
  mismoDia: db.prepare('SELECT id, unidad, reporto, pulpos_id FROM combustible WHERE date(creado_en) = date(?) AND importe = ? ORDER BY id'),
  hoy: db.prepare(`SELECT id, unidad, reporto, pulpos_id FROM combustible WHERE date(creado_en) = date('now', 'localtime') AND importe = ? ORDER BY id`),
  ligar: db.prepare('UPDATE combustible SET pulpos_id = ? WHERE id = ?'),
  completar: db.prepare('UPDATE combustible SET unidad = @unidad, reporto = @reporto, litros = COALESCE(@litros, litros), mensaje = @mensaje WHERE id = @id'),
  ligadas: db.prepare(`SELECT id, pulpos_id, reporto, unidad, importe, mensaje, creado_en FROM combustible
    WHERE pulpos_id IS NOT NULL AND creado_en >= datetime('now', 'localtime', '-3 days')`),
  borrar: db.prepare('DELETE FROM combustible WHERE id = ?'),
  desligar: db.prepare('UPDATE combustible SET pulpos_id = NULL WHERE id = ?'),
  anotar: db.prepare(`INSERT OR IGNORE INTO combustible (unidad, importe, concepto, litros, reporto, mensaje, creado_en, pulpos_id)
    VALUES (@unidad, @importe, @concepto, NULL, @reporto, @mensaje, @creado_en, @pulpos_id)`),
};

// "2026-11-05T15:26:42.094Z" -> "2026-11-05 09:26:42" en la hora de la Oficina.
function horaLocal(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Movimientos de caja de Pulpos -> cargas de combustible. Sólo retiros vivos que hablan de combustible.
function aCargas(movimientos, fuente = PULPOS) {
  return (movimientos ?? [])
    .filter((m) => m?.id && !m.deletedAt && Number(m.amount) < 0 && esCombustible(m.details))
    .map((m) => {
      const texto = limpio(m.details);
      return {
        pulpos_id: m.id,
        unidad: UNIDADES.find((u) => u.es.test(texto))?.nombre ?? 'SIN UNIDAD',
        importe: Math.abs(Number(m.amount)),
        concepto: /\b(diesel|disel)\b/.test(texto) ? 'diesel' : 'gasolina',
        reporto: fuente.reporto,
        mensaje: String(m.details).trim(),
        creado_en: horaLocal(m.createdAt),
      };
    })
    .filter((c) => c.creado_en);
}

const misma = (a, b) => a === 'SIN UNIDAD' || b === 'SIN UNIDAD' || unidadCanonica(a) === unidadCanonica(b);

// De Pulpos: si ya la reportaron (WhatsApp o a mano) ese día por el mismo importe y unidad, sólo se liga.
function anotarUna(c, fuente = PULPOS) {
  if (stmts.mismoDia.all(c.creado_en, c.importe).some((r) => r.pulpos_id === c.pulpos_id)) return false;
  const reportada = stmts.mismoDia.all(c.creado_en, c.importe).find((r) => !r.pulpos_id && misma(r.unidad, c.unidad));
  if (reportada) {
    stmts.ligar.run(c.pulpos_id, reportada.id);
    console.log(`${fuente.log} combustible de caja ya reportado: ${c.unidad} $${c.importe} (${c.mensaje})`);
    return false;
  }
  return stmts.anotar.run(c).changes > 0;
}

// Reporte por WhatsApp o a mano de hoy: si esa carga ya entró de la Caja de Pulpos, se completa esa fila
// (quién reportó, litros) en lugar de anotar otra. Devuelve true si se emparejó.
function emparejarReporte({ unidad, importe, litros = null, reporto, mensaje = '' }) {
  const dePulpos = stmts.hoy.all(importe).find((r) => DE_CAJA.has(r.reporto) && misma(r.unidad, unidad));
  if (!dePulpos) return false;
  stmts.completar.run({
    id: dePulpos.id,
    unidad: dePulpos.unidad === 'SIN UNIDAD' ? unidadCanonica(unidad) : dePulpos.unidad,
    reporto,
    litros: litros > 0 ? litros : null,
    mensaje: mensaje || 'Reportado también en la Oficina',
  });
  return true;
}

// Retiros que ya entraron y que la Caja ya no manda: si sólo venían de Pulpos se quitan; si alguien también
// los reportó (WhatsApp o a mano) se quedan, sólo se desligan de Pulpos. Devuelve cuántas se quitaron/desligaron.
function quitarBorrados(movimientos, fuente = PULPOS) {
  const vivos = (movimientos ?? []).filter((m) => m?.id && !m.deletedAt);
  const ids = new Set(vivos.map((m) => m.id));
  const horas = vivos.map((m) => horaLocal(m.createdAt)).filter(Boolean);
  let cambios = 0;
  for (const r of stmts.ligadas.all()) {
    if (!esDe(fuente, r.pulpos_id) || ids.has(r.pulpos_id)) continue;
    // Sin movimientos anteriores en la Caja no se sabe si fue un borrado o el corte: se deja.
    if (!fuente.exacto && !horas.some((h) => h <= r.creado_en)) continue;
    if (r.reporto === fuente.reporto) {
      stmts.borrar.run(r.id);
      console.log(`${fuente.log} borrado en la Caja, se quita de Edgar: ${r.unidad} $${r.importe} (${r.mensaje})`);
    } else {
      stmts.desligar.run(r.id);
      console.log(`${fuente.log} borrado en la Caja; se queda lo que reportó ${r.reporto}: ${r.unidad} $${r.importe}`);
    }
    cambios++;
  }
  return cambios;
}

// Devuelve las cargas nuevas que se anotaron.
function anotar(movimientos, fuente = PULPOS) {
  quitarBorrados(movimientos, fuente);
  const nuevas = aCargas(movimientos, fuente).filter((c) => anotarUna(c, fuente));
  for (const c of nuevas) console.log(`${fuente.log} combustible de caja: ${c.unidad} $${c.importe} (${c.mensaje})`);
  return nuevas;
}

module.exports = { aCargas, anotar, quitarBorrados, horaLocal, emparejarReporte, unidadCanonica, REPORTO, FUENTES: { PULPOS, POS } };
