// Consultas a la base de SICAR: SÓLO VENTAS. Nada de inventario, existencias, compras ni almacén.
// Toda consulta pasa por leer(), que rechaza lo que no sea un SELECT sobre las tablas de ventas.
// Los nombres exactos de tablas y columnas se confirman con `npm run sicar:explorar` (no se adivinan).
//
// ventasDesde debe devolver un arreglo de ventas con la forma que espera el importador:
//   { cliente: { nombre }, nota: { origen: 'sicar', folio, material, cantidad, unidad,
//                                  detalle, total, direccion } }
// Mientras no esté mapeado devuelve null y la oficina muestra "falta mapear tablas".

// Tablas que sí se pueden leer: ventas/tickets, sus renglones y el cliente de la venta.
const ES_DE_VENTAS = /^(venta|ventas|detallev|detalle_?venta|ticket|tickets|nota|notas|cliente|clientes)$/i;
// Palabras que no pueden aparecer en ninguna parte de la consulta (ni tabla ni columna).
const PROHIBIDA = /inventario|existencia|stock|almacen|kardex|compra|entrada|salida|traspaso|ajuste|lote/i;

// Rechaza todo lo que no sea un solo SELECT sobre tablas de ventas.
function revisarSQL(sql) {
  const s = String(sql).trim().replace(/;\s*$/, '');
  if (!/^select\b/i.test(s) || s.includes(';')) throw new Error('SICAR: sólo se permite un SELECT');
  if (PROHIBIDA.test(s)) throw new Error('SICAR: la consulta toca inventario, compras o almacén');
  if (/\b(into\s+outfile|into\s+dumpfile|for\s+update|lock\s+in\s+share|sleep\s*\(|benchmark\s*\()/i.test(s)) {
    throw new Error('SICAR: SELECT no permitido');
  }
  if (/\bfrom\s+[\w`.]+(\s+(as\s+)?\w+)?\s*,/i.test(s)) throw new Error('SICAR: une tablas con JOIN, no con comas');
  const tablas = [...s.matchAll(/\b(?:from|join)\s+`?(?:\w+`?\.`?)?(\w+)`?/gi)].map((m) => m[1]);
  const mala = tablas.find((t) => !ES_DE_VENTAS.test(t));
  if (mala) throw new Error(`SICAR: la tabla "${mala}" no es de ventas`);
  return s;
}

const leer = async (pool, sql, params = []) => (await pool.query(revisarSQL(sql), params))[0];

async function ventasDesde(pool, _desde) {
  await leer(pool, 'SELECT 1'); // confirma que la conexión y el usuario funcionan
  return null;
}

module.exports = { ventasDesde, leer, revisarSQL };
