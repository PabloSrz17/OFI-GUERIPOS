// Pizarra de asistencias: se pasa lista de lunes a sábado.
const db = require('../db/connection');
const { httpError } = require('../lib/errors');

const stmts = {
  trabajadores: db.prepare('SELECT id, nombre FROM trabajadores WHERE activo = 1 ORDER BY id'),
  existe: db.prepare('SELECT 1 FROM trabajadores WHERE id = ? AND activo = 1'),
  marcas: db.prepare('SELECT trabajador_id, fecha, estado FROM asistencias WHERE fecha BETWEEN ? AND ?'),
  guardar: db.prepare(`
    INSERT INTO asistencias (trabajador_id, fecha, estado) VALUES (?, ?, ?)
    ON CONFLICT (trabajador_id, fecha) DO UPDATE SET estado = excluded.estado, actualizado_en = datetime('now', 'localtime')`),
  quitar: db.prepare('DELETE FROM asistencias WHERE trabajador_id = ? AND fecha = ?'),
  faltanPorMarcar: db.prepare(`
    SELECT COUNT(*) AS n FROM trabajadores t
    WHERE t.activo = 1 AND NOT EXISTS (SELECT 1 FROM asistencias a WHERE a.trabajador_id = t.id AND a.fecha = ?)`),
};

const fechaLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// estado: 'asistio' | 'falta' | 'retardo' | null (borra la marca).
function marcar(trabajadorId, fecha, estado, hoy = new Date()) {
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? new Date(`${fecha}T12:00:00`) : null;
  if (!dia || Number.isNaN(dia.getTime()) || fechaLocal(dia) !== fecha) throw httpError(400, 'Fecha inválida');
  if (dia.getDay() === 0) throw httpError(400, 'Los domingos no se pasa lista');
  if (fecha > fechaLocal(hoy)) throw httpError(400, 'No se puede marcar un día que no ha llegado');
  if (!stmts.existe.get(trabajadorId)) throw httpError(404, 'Trabajador no encontrado');
  if (estado === null) stmts.quitar.run(trabajadorId, fecha);
  else if (['asistio', 'falta', 'retardo'].includes(estado)) stmts.guardar.run(trabajadorId, fecha, estado);
  else throw httpError(400, 'Estado inválido');
}

// De lunes a sábado, desde las 10:00, mientras alguien siga sin marcar.
function pendienteHoy(ahora = new Date()) {
  if (ahora.getDay() === 0 || ahora.getHours() < 10) return false;
  return stmts.faltanPorMarcar.get(fechaLocal(ahora)).n > 0;
}

module.exports = {
  marcar,
  pendienteHoy,
  semana: (desde, hasta) => ({ trabajadores: stmts.trabajadores.all(), marcas: stmts.marcas.all(desde, hasta) }),
};
