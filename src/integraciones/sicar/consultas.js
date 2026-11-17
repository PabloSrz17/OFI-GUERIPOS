// Consultas a la base de SICAR: SÓLO VENTAS Y COMPRAS. Nada de inventario, existencias ni almacén.
// Toda consulta pasa por leer(), que rechaza lo que no sea un SELECT sobre esas tablas.
//
// Estructura (SICAR 4, MySQL 5.6, revisada el 2026-11-06):
//   venta    ven_id, fecha, total, status (1 vigente, -1 cancelada), not_id (= folio de la nota)
//   nota     not_id, cli_id            cliente   cli_id, nombre, domicilio, colonia, celular, comentario…
//   detallev ven_id, descripcion, cantidad, unidad, importeCon, orden
//   compra   com_id, folio, fecha, total, status, pro_id      detallec  com_id, descripcion, cantidad, unidad, orden
//   proveedor pro_id, nombre   (las compras se capturan en SICAR al pedirle al proveedor)
const { normalizar } = require('../../lib/telefono');
const { conBolsa } = require('./texto');

// Tablas que sí se pueden leer: ventas/tickets, sus renglones, el cliente; compras, sus renglones y el proveedor.
const ES_DE_VENTAS = /^(venta|ventas|detallev|detalle_?venta|ticket|tickets|nota|notas|cliente|clientes|compra|detallec|proveedor)$/i;
// Palabras que no pueden aparecer en ninguna parte de la consulta (ni tabla ni columna).
const PROHIBIDA = /inventario|existencia|stock|almacen|kardex|entrada|salida|traspaso|ajuste|lote/i;

// Rechaza todo lo que no sea un solo SELECT sobre tablas de ventas o compras.
function revisarSQL(sql) {
  const s = String(sql).trim().replace(/;\s*$/, '');
  if (!/^select\b/i.test(s) || s.includes(';')) throw new Error('SICAR: sólo se permite un SELECT');
  if (PROHIBIDA.test(s)) throw new Error('SICAR: la consulta toca inventario o almacén');
  if (/\b(into\s+outfile|into\s+dumpfile|for\s+update|lock\s+in\s+share|sleep\s*\(|benchmark\s*\()/i.test(s)) {
    throw new Error('SICAR: SELECT no permitido');
  }
  if (/\bfrom\s+[\w`.]+(\s+(as\s+)?\w+)?\s*,/i.test(s)) throw new Error('SICAR: une tablas con JOIN, no con comas');
  const tablas = [...s.matchAll(/\b(?:from|join)\s+`?(?:\w+`?\.`?)?(\w+)`?/gi)].map((m) => m[1]);
  const mala = tablas.find((t) => !ES_DE_VENTAS.test(t));
  if (mala) throw new Error(`SICAR: la tabla "${mala}" no es de ventas ni compras`);
  return s;
}

const leer = async (pool, sql, params = []) => (await pool.query(revisarSQL(sql), params))[0];

const ES_ENVIO = /ENV[IÍ]O|FLETE/i;
const PUBLICO = /^p[uú]blico en general$/i;
const UNIDAD = (u) => (/^(pza|pzas|pieza|piezas|pz)$/i.test(String(u ?? '').trim()) ? 'pz' : String(u ?? '').trim().toLowerCase() || 'pz');
const numero = (n) => Number(Number(n).toFixed(3));
const texto = (t) => String(t ?? '').trim();

// Entra al tablero la nota con cliente registrado (no PÚBLICO EN GENERAL), dirección y celular.
// Sulema pregunta después si es envío o la cargan en Almacén.
const entra = (fila) => Boolean(fila.cli_id && fila.cli_id !== 1 && !PUBLICO.test(texto(fila.nombre))
  && texto(fila.domicilio) && normalizar(texto(fila.celular) || texto(fila.telefono)));

// Fila de SICAR (venta + nota + cliente) y sus renglones -> venta del importador.
function aVenta(fila, renglones) {
  const productos = renglones.filter((r) => !ES_ENVIO.test(r.descripcion)).map((r) => ({
    material: conBolsa(texto(r.descripcion)) || 'SIN DESCRIPCIÓN',
    cantidad: numero(r.cantidad),
    unidad: UNIDAD(r.unidad),
  }));
  const [principal = { material: 'VER EN SICAR: LA NOTA NO TRAE PRODUCTOS', cantidad: 1, unidad: 'nota' }] = productos;
  const lugar = [texto(fila.domicilio) + (texto(fila.noExt) ? ` #${texto(fila.noExt)}` : ''), texto(fila.colonia) && `COL ${texto(fila.colonia)}`, texto(fila.localidad) || texto(fila.ciudad)]
    .filter(Boolean).join(', ');
  const direccion = lugar ? `${lugar}${texto(fila.referencia) ? ` · ${texto(fila.referencia)}` : ''}` : 'Sin dirección (ver en SICAR)';
  const telefono = normalizar(texto(fila.celular) || texto(fila.telefono)) || null;
  return {
    cliente: { nombre: texto(fila.nombre) || `SIN NOMBRE ${fila.folio}`, telefono },
    nota: {
      origen: 'sicar',
      folio: String(fila.folio),
      id_externo: String(fila.ven_id),
      material: principal.material,
      cantidad: principal.cantidad,
      unidad: principal.unidad,
      detalle: productos.length > 1 ? productos.map((p) => `${p.cantidad} ${p.unidad} ${p.material}`).join('\n') : null,
      total: Number(fila.total) || null,
      direccion,
      telefono,
      creado_en: fila.fecha,
    },
  };
}

// De estos folios, los que están cancelados en SICAR. Sólo notas de los últimos 30 días: un folio
// viejo cancelado (ej. la nota 287 de 2021) no debe tumbar una nota de SALIDA que se llame igual.
async function canceladasDe(pool, folios) {
  const numeros = [...new Set(folios.filter((f) => /^\d+$/.test(f)).map(Number))];
  if (!numeros.length) return [];
  const filas = await leer(pool, `SELECT DISTINCT not_id FROM venta WHERE status <> 1 AND fecha >= NOW() - INTERVAL 30 DAY
    AND not_id IN (${numeros.map(() => '?').join(',')})`, numeros);
  return filas.map((f) => String(f.not_id));
}

// Notas de SICAR desde `desde` (Date) para el tablero.
async function ventasDesde(pool, desde) {
  const p = (n) => String(n).padStart(2, '0');
  const fecha = `${desde.getFullYear()}-${p(desde.getMonth() + 1)}-${p(desde.getDate())} ${p(desde.getHours())}:${p(desde.getMinutes())}:00`;
  const filas = await leer(pool, `
    SELECT v.ven_id, v.not_id AS folio, v.fecha, v.total, v.status, n.cli_id, c.nombre, c.domicilio, c.noExt,
      c.colonia, c.localidad, c.ciudad, c.celular, c.telefono, c.comentario AS referencia
    FROM venta v JOIN nota n ON n.not_id = v.not_id LEFT JOIN cliente c ON c.cli_id = n.cli_id
    WHERE v.fecha >= ? AND v.not_id IS NOT NULL ORDER BY v.ven_id`, [fecha]);
  const vigentes = filas.filter((f) => f.status === 1 && entra(f));
  if (!vigentes.length) return [];
  const ids = vigentes.map((f) => f.ven_id);
  const renglones = await leer(pool, `SELECT ven_id, descripcion, cantidad, unidad FROM detallev
    WHERE ven_id IN (${ids.map(() => '?').join(',')}) ORDER BY ven_id, orden`, ids);
  return vigentes.map((f) => aVenta(f, renglones.filter((r) => r.ven_id === f.ven_id)));
}

// Compras vigentes de SICAR desde `desde` (Date), para el pizarrón de Max:
// [{ externo (com_id), folio, proveedor, fecha, renglones: [{ cantidad, unidad, material }] }].
async function comprasDesde(pool, desde) {
  const p = (n) => String(n).padStart(2, '0');
  const fecha = `${desde.getFullYear()}-${p(desde.getMonth() + 1)}-${p(desde.getDate())} ${p(desde.getHours())}:${p(desde.getMinutes())}:00`;
  const compras = await leer(pool, `SELECT c.com_id, c.folio, c.fecha, pr.nombre AS proveedor FROM compra c
    LEFT JOIN proveedor pr ON pr.pro_id = c.pro_id WHERE c.fecha >= ? AND c.status = 1 AND c.gasto = 0 ORDER BY c.com_id`, [fecha]);
  if (!compras.length) return [];
  const ids = compras.map((c) => c.com_id);
  const renglones = await leer(pool, `SELECT com_id, descripcion, cantidad, unidad FROM detallec
    WHERE com_id IN (${ids.map(() => '?').join(',')}) ORDER BY com_id, orden`, ids);
  return compras.map((c) => ({
    externo: String(c.com_id),
    folio: texto(c.folio) || String(c.com_id),
    proveedor: texto(c.proveedor).toUpperCase() || null,
    fecha: c.fecha,
    renglones: renglones.filter((r) => r.com_id === c.com_id).map((r) => ({
      cantidad: String(numero(r.cantidad)), unidad: UNIDAD(r.unidad), material: conBolsa(texto(r.descripcion)).toUpperCase() || 'SIN DESCRIPCIÓN',
    })),
  }));
}

// De estas compras (com_id), las canceladas en SICAR.
async function comprasCanceladas(pool, externos) {
  const ids = externos.filter((e) => /^\d+$/.test(e)).map(Number);
  if (!ids.length) return [];
  const filas = await leer(pool, `SELECT com_id FROM compra WHERE status <> 1 AND com_id IN (${ids.map(() => '?').join(',')})`, ids);
  return filas.map((f) => String(f.com_id));
}

module.exports = { ventasDesde, canceladasDe, comprasDesde, comprasCanceladas, leer, revisarSQL, aVenta };
