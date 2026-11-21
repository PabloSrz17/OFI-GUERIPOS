// Cotizaciones de El Inspector, lista de precios y fletes por colonia.
const db = require('../db/connection');
const clientes = require('./clientes.repo');
const { clave, unidadCotizacion } = require('../integraciones/inspector/cotizador');

const stmts = {
  precios: db.prepare('SELECT * FROM precios WHERE activo = 1 ORDER BY nombre'),
  precioPorId: db.prepare('SELECT * FROM precios WHERE id = ?'),
  cambiarUnidad: db.prepare(`UPDATE precios SET unidad = ?, actualizado_en = datetime('now', 'localtime') WHERE id = ?`),
  quitarPrecio: db.prepare(`UPDATE precios SET activo = 0, actualizado_en = datetime('now', 'localtime') WHERE id = ? AND activo = 1`),
  nuevoPrecio: db.prepare('INSERT INTO precios (nombre, unidad, precio, claves) VALUES (?, ?, ?, ?)'),
  cambiarPrecio: db.prepare(`UPDATE precios SET precio = ?, actualizado_en = datetime('now', 'localtime') WHERE id = ?`),
  fletes: db.prepare('SELECT * FROM fletes ORDER BY colonia'),
  flete: db.prepare('SELECT * FROM fletes WHERE colonia_clave = ?'),
  guardarFlete: db.prepare(`
    INSERT INTO fletes (colonia, colonia_clave, precio) VALUES (?, ?, ?)
    ON CONFLICT (colonia_clave) DO UPDATE SET precio = excluded.precio, actualizado_en = datetime('now', 'localtime')`),
  insertar: db.prepare(`
    INSERT INTO cotizaciones (cliente_id, colonia, solicitud, total, metodo_pago) VALUES (?, ?, ?, ?, ?)`),
  partida: db.prepare(`
    INSERT INTO cotizacion_partidas (cotizacion_id, orden, tipo, descripcion, cantidad, unidad, precio, importe)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  porId: db.prepare(`
    SELECT co.*, cl.nombre AS cliente, cl.telefono AS cliente_telefono
    FROM cotizaciones co JOIN clientes cl ON cl.id = co.cliente_id WHERE co.id = ?`),
  partidas: db.prepare('SELECT * FROM cotizacion_partidas WHERE cotizacion_id = ? ORDER BY orden'),
  recientes: db.prepare(`
    SELECT co.id, co.total, co.colonia, co.whatsapp, co.creado_en, co.estado, co.seguimiento_estado, co.seguimiento_para,
           co.aviso_cliente, co.aviso_en, co.aviso_texto,
           cl.nombre AS cliente, cl.telefono AS cliente_telefono
    FROM cotizaciones co JOIN clientes cl ON cl.id = co.cliente_id
    ORDER BY co.id DESC LIMIT ?`),
  whatsapp: db.prepare('UPDATE cotizaciones SET whatsapp = ? WHERE id = ?'),
  borrarPartidas: db.prepare('DELETE FROM cotizacion_partidas WHERE cotizacion_id = ?'),
  cambiarTotal: db.prepare('UPDATE cotizaciones SET total = ? WHERE id = ?'),
  cambiarDatos: db.prepare('UPDATE cotizaciones SET cliente_id = ?, colonia = ? WHERE id = ?'),
  // Si ya se pagó o se cerró, o si el recordatorio ya salió, no se vuelve a programar.
  programar: db.prepare(`
    UPDATE cotizaciones SET
      enviada_en = datetime('now', 'localtime'),
      seguimiento_para = CASE WHEN estado = 'aprobada' AND seguimiento_estado IS NOT 'enviado'
        THEN datetime('now', 'localtime', '+24 hours') ELSE seguimiento_para END,
      seguimiento_estado = CASE WHEN estado = 'aprobada' AND seguimiento_estado IS NOT 'enviado'
        THEN 'pendiente' ELSE seguimiento_estado END
    WHERE id = ?`),
  marcar: db.prepare(`
    UPDATE cotizaciones SET estado = @estado,
      pagada_en = CASE WHEN @estado = 'pagada' THEN datetime('now', 'localtime') END,
      seguimiento_estado = CASE
        WHEN @estado <> 'aprobada' AND seguimiento_estado = 'pendiente' THEN 'cancelado'
        WHEN @estado = 'aprobada' AND seguimiento_estado = 'cancelado' THEN 'pendiente'
        ELSE seguimiento_estado END
    WHERE id = @id`),
  seguimientosVencidos: db.prepare(`
    SELECT co.id, cl.telefono FROM cotizaciones co JOIN clientes cl ON cl.id = co.cliente_id
    WHERE co.estado = 'aprobada' AND co.seguimiento_estado = 'pendiente' AND co.seguimiento_para <= datetime('now', 'localtime')`),
  seguimientoResultado: db.prepare('UPDATE cotizaciones SET seguimiento_estado = ? WHERE id = ?'),
  hoy: db.prepare(`SELECT COUNT(*) AS n FROM cotizaciones WHERE date(creado_en) = date('now', 'localtime')`),
};

const folio = (id) => `C-${String(id).padStart(4, '0')}`;

function obtener(id) {
  const c = stmts.porId.get(id);
  return c && { ...c, folio: folio(c.id), partidas: stmts.partidas.all(id) };
}

// Lo que se aprende al aprobar: productos nuevos a la lista, precios corregidos (si se pidió)
// y el flete de la colonia. Devuelve un resumen para mostrarlo.
function aprender(partidas, colonia, actualizarPrecios) {
  const aprendido = { nuevos: [], actualizados: [], flete: null };
  for (const p of partidas) {
    if (p.tipo === 'flete') {
      const previo = stmts.flete.get(clave(colonia));
      if (!previo || (actualizarPrecios && previo.precio !== p.precio)) {
        stmts.guardarFlete.run(colonia, clave(colonia), p.precio);
        aprendido.flete = colonia;
      }
      continue;
    }
    // Mismo nombre que uno ya guardado ("Varilla 3/8" = "VARILLA 3/8"): ése, no uno repetido.
    const enLista = (p.precio_id ? stmts.precioPorId.get(p.precio_id) : null)
      ?? stmts.precios.all().find((x) => clave(x.nombre) === clave(p.descripcion));
    if (!enLista) {
      const claves = [...new Set([clave(p.texto), clave(p.descripcion)].filter(Boolean))].join(',');
      stmts.nuevoPrecio.run(p.descripcion, p.unidad, p.precio, claves);
      aprendido.nuevos.push(p.descripcion);
    } else if (actualizarPrecios) {
      const otroPrecio = enLista.precio !== p.precio;
      // La unidad también es del concepto: la próxima vez se pone sola ("Block de 10" -> pza).
      const otraUnidad = p.unidad && unidadCotizacion(enLista.unidad) !== p.unidad;
      if (otroPrecio) stmts.cambiarPrecio.run(p.precio, enLista.id);
      if (otraUnidad) stmts.cambiarUnidad.run(p.unidad, enLista.id);
      if (otroPrecio || otraUnidad) aprendido.actualizados.push(enLista.nombre);
    }
  }
  return aprendido;
}

// cotizacion: { cliente, telefono, colonia, solicitud, partidas (ya calculadas), total }
const aprobar = db.transaction((cotizacion, actualizarPrecios) => {
  const clienteId = clientes.obtenerOCrear({ nombre: cotizacion.cliente, telefono: cotizacion.telefono });
  if (cotizacion.telefono) clientes.actualizarTelefono(clienteId, cotizacion.telefono);
  const { lastInsertRowid: id } = stmts.insertar.run(clienteId, cotizacion.colonia, cotizacion.solicitud, cotizacion.total, cotizacion.metodo_pago ?? null);
  cotizacion.partidas.forEach((p, i) =>
    stmts.partida.run(id, i + 1, p.tipo, p.descripcion, p.cantidad, p.unidad, p.precio, p.importe));
  const aprendido = aprender(cotizacion.partidas, cotizacion.colonia, actualizarPrecios);
  return { cotizacion: obtener(id), aprendido };
});

// Edición manual desde el historial: cambia renglones y total, y si vienen, cliente, teléfono y colonia.
// El folio (C-0035) sale del id y la fecha no se toca. Cambiar el nombre no renombra al cliente en las
// demás notas: la cotización pasa al cliente con ese nombre (o a uno nuevo).
const editar = db.transaction((id, { partidas, total }, datos = null) => {
  if (!stmts.porId.get(id)) return null;
  if (datos) {
    const clienteId = clientes.obtenerOCrear({ nombre: datos.cliente, telefono: datos.telefono });
    if (datos.telefono) clientes.actualizarTelefono(clienteId, datos.telefono);
    stmts.cambiarDatos.run(clienteId, datos.colonia, id);
  }
  stmts.borrarPartidas.run(id);
  partidas.forEach((p, i) => stmts.partida.run(id, i + 1, p.tipo === 'flete' ? 'flete' : 'producto', p.descripcion, p.cantidad, String(p.unidad ?? '').trim(), p.precio, p.importe));
  stmts.cambiarTotal.run(total, id);
  return obtener(id);
});

module.exports = {
  editar,
  precios: () => stmts.precios.all(),
  // 🧹 Se oculta (activo = 0): ya no se sugiere ni se cotiza; las cotizaciones viejas no cambian.
  quitarPrecio: (id) => stmts.quitarPrecio.run(id).changes > 0,
  fletes: () => stmts.fletes.all(),
  fletePorColonia: (colonia) => stmts.flete.get(clave(colonia)) ?? null,
  aprobar,
  obtener,
  recientes: (limite = 10) => stmts.recientes.all(limite).map((c) => ({ ...c, folio: folio(c.id) })),
  marcarWhatsapp: (id, estado) => {
    stmts.whatsapp.run(estado, id);
    if (estado === 'enviado') stmts.programar.run(id);
  },
  marcarEstado: (id, estado) => stmts.marcar.run({ id, estado }).changes > 0,
  seguimientosVencidos: () => stmts.seguimientosVencidos.all(),
  marcarSeguimiento: (id, estado) => stmts.seguimientoResultado.run(estado, id),
  hoy: () => stmts.hoy.get().n,
};
