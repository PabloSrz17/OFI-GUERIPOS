function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Traduce errores de restricción de SQLite a respuestas HTTP entendibles.
const SQLITE_ERRORES = {
  SQLITE_CONSTRAINT_UNIQUE: [409, 'Ese folio ya está en el tablero'],
  SQLITE_CONSTRAINT_FOREIGNKEY: [400, 'El cliente o chofer indicado no existe'],
  SQLITE_CONSTRAINT_CHECK: [400, 'Datos fuera de rango'],
};

function manejadorErrores(err, req, res, next) {
  const [status, mensaje] = SQLITE_ERRORES[err.code] ?? [err.status ?? 500, err.message];
  if (status >= 500) console.error(err);
  // Sólo se ocultan los errores inesperados; los que traen status propio tienen mensaje para el usuario.
  res.status(status).json({ error: status >= 500 && !err.status ? 'Error interno del servidor' : mensaje });
}

module.exports = { httpError, manejadorErrores };
