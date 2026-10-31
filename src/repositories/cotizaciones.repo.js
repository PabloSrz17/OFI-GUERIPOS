// Cotizaciones de El Inspector, lista de precios y fletes por colonia.
const db = require('../db/connection');
const clientes = require('./clientes.repo');
const { clave } = require('../integraciones/inspector/cotizador');

const stmts = {
  precios: db.prepare('SELECT * FROM precios WHERE activo = 1 ORDER BY nombre'),
  precioPorId: db.prepare('SELECT * FROM precios WHERE id = ?'),
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
           cl.nombre AS cliente, cl.telefono AS cliente_telefono
    FROM cotizaciones co JOIN clientes cl ON cl.id = co.cliente_id
    ORDER BY co.id DESC LIMIT ?`),
  whatsapp: db.prepare('UPDATE cotizaciones SET whatsapp = ? WHERE id = ?'),
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
    const enLista = p.precio_id ? stmts.precioPorId.get(p.precio_id) : null;
    if (!enLista) {
      const claves = [...new Set([clave(p.texto), clave(p.descripcion)].filter(Boolean))].join(',');
      stmts.nuevoPrecio.run(p.descripcion, p.unidad, p.precio, claves);
      aprendido.nuevos.push(p.descripcion);
    } else if (actualizarPrecios && enLista.precio !== p.precio) {
      stmts.cambiarPrecio.run(p.precio, enLista.id);
      aprendido.actualizados.push(enLista.nombre);
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

module.exports = {
  precios: () => stmts.precios.all(),
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
