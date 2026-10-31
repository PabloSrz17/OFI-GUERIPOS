const db = require('../db/connection');

const stmts = {
  activos: db.prepare('SELECT id, nombre FROM camiones WHERE activo = 1 ORDER BY nombre'),
  // Estado de cada camión según sus notas: en ruta > cargando > en patio.
  conEstado: db.prepare(`
    SELECT ca.id, ca.nombre,
      CASE
        WHEN EXISTS (SELECT 1 FROM notas n WHERE n.camion_id = ca.id AND n.estado = 'en_ruta') THEN 'en_ruta'
        WHEN EXISTS (SELECT 1 FROM notas n WHERE n.camion_id = ca.id AND n.estado = 'cargando') THEN 'cargando'
        ELSE 'patio'
      END AS estado
    FROM camiones ca WHERE ca.activo = 1 ORDER BY ca.nombre`),
};

module.exports = {
  listarActivos: () => stmts.activos.all(),
  conEstado: () => stmts.conEstado.all(),
};
