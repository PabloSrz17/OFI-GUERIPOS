const db = require('../db/connection');

const stmts = {
  listar: db.prepare('SELECT * FROM clientes ORDER BY nombre'),
  contar: db.prepare('SELECT COUNT(*) AS total FROM clientes'),
  porId: db.prepare('SELECT * FROM clientes WHERE id = ?'),
  porNombre: db.prepare('SELECT id, telefono FROM clientes WHERE nombre = ? COLLATE NOCASE'),
  insertar: db.prepare('INSERT INTO clientes (nombre, telefono, zona) VALUES (?, ?, ?)'),
  telefono: db.prepare('UPDATE clientes SET telefono = ? WHERE id = ?'),
};

// Los conectores sólo conocen el nombre del cliente; se reutiliza si ya existe y, si no tenía
// teléfono y ahora llega uno, se le guarda.
function obtenerOCrear({ nombre, telefono = null, zona = null }) {
  const existente = stmts.porNombre.get(nombre);
  if (!existente) return Number(stmts.insertar.run(nombre, telefono, zona).lastInsertRowid);
  if (telefono && !existente.telefono) stmts.telefono.run(telefono, existente.id);
  return existente.id;
}

function actualizarTelefono(id, telefono) {
  stmts.telefono.run(telefono, id);
  return stmts.porId.get(id);
}

module.exports = {
  listar: () => stmts.listar.all(),
  contar: () => stmts.contar.get().total,
  obtener: (id) => stmts.porId.get(id),
  obtenerOCrear,
  actualizarTelefono,
};
