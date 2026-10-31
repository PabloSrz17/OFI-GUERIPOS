const db = require('../db/connection');

const stmts = {
  activos: db.prepare('SELECT id, nombre, telefono, almacen FROM choferes WHERE activo = 1 ORDER BY almacen DESC, nombre'),
};

module.exports = {
  listarActivos: () => stmts.activos.all(),
};
