// Consultas a la base de SICAR. Los nombres de tablas y columnas se completan después de
// correr `npm run sicar:explorar` con el usuario de sólo lectura (no se adivinan).
//
// ventasDesde debe devolver un arreglo de ventas con la forma que espera el importador:
//   { cliente: { nombre }, nota: { origen: 'sicar', folio, material, cantidad, unidad,
//                                  detalle, total, direccion } }
// Mientras no esté mapeado devuelve null y la oficina muestra "falta mapear tablas".

async function ventasDesde(pool, _desde) {
  await pool.query('SELECT 1'); // confirma que la conexión y el usuario funcionan
  return null;
}

module.exports = { ventasDesde };
