// El Inspector: cotizaciones. Flujo: borrador -> el usuario lo revisa y corrige en la Oficina
// ("¿Está correcta esta cotización?") -> aprobar (guarda y aprende precios/fletes) -> imagen
// tipo Excel -> WhatsApp al cliente si tiene teléfono y así se pidió.
const express = require('express');
const cotizaciones = require('../repositories/cotizaciones.repo');
const { interpretarSolicitud, armarBorrador, calcular } = require('../integraciones/inspector/cotizador');
const { generarPNG } = require('../integraciones/inspector/imagen');
const { normalizar } = require('../lib/telefono');
const { unidadDe, conBolsa } = require('../integraciones/sicar/texto');
const whatsapp = require('../integraciones/whatsapp/cliente');
const { httpError } = require('../lib/errors');
const bus = require('../events/bus');
const solicitudes = require('../integraciones/inspector/solicitudes');
const notas = require('../repositories/notas.repo');
const clientes = require('../repositories/clientes.repo');

const router = express.Router();

// Historial: ?limite= hasta 200 (sin él, las últimas 10).
router.get('/', (req, res) => res.json(cotizaciones.recientes(Math.min(Math.max(Number(req.query.limite) || 10, 1), 200))));
router.get('/precios', (req, res) => res.json({ precios: cotizaciones.precios(), fletes: cotizaciones.fletes() }));
router.delete('/precios/:id', (req, res) => {
  if (!cotizaciones.quitarPrecio(Number(req.params.id))) return res.status(404).json({ error: 'Ese concepto ya no está' });
  return res.status(204).end();
});

// Bandeja de solicitudes que llegaron por WhatsApp (pendientes de revisar).
router.get('/solicitudes', (req, res) => res.json(solicitudes.pendientes()));
router.post('/solicitudes/:id/descartar', (req, res) => {
  solicitudes.marcar(Number(req.params.id), 'descartada');
  res.status(204).end();
});

// Tarjeta -> nota en Pendiente, con la foto del cliente. No le manda nada al cliente.
router.post('/solicitudes/:id/nota', (req, res) => {
  const id = Number(req.params.id);
  const b = req.body ?? {};
  if (!solicitudes.sigueAbierta(id)) throw httpError(409, 'Esa solicitud ya se atendió');
  const cliente = String(b.cliente ?? '').trim().toUpperCase();
  const colonia = String(b.colonia ?? '').trim();
  const telefonoTexto = String(b.telefono ?? '').trim();
  const telefono = telefonoTexto ? normalizar(telefonoTexto) : null;
  const articulos = (b.partidas ?? [])
    .filter((p) => p.tipo !== 'flete' && String(p.descripcion ?? '').trim())
    .map((p) => ({ cantidad: String(p.cantidad ?? '').trim(), unidad: String(p.unidad ?? '').trim(), material: String(p.descripcion).trim() }));
  if (!cliente || !colonia) throw httpError(400, 'Falta el cliente o la colonia');
  if (telefonoTexto && !telefono) throw httpError(400, 'Teléfono inválido: escribe los 10 dígitos');
  if (!articulos.length || !articulos[0].cantidad) throw httpError(400, 'Falta la cantidad o la descripción del primer artículo');
  const nota = notas.crear({
    origen: 'whatsapp',
    folio: `WA-${id}`,
    cliente_id: clientes.obtenerOCrear({ nombre: cliente, telefono }),
    ...articulos[0],
    detalle: articulos.length > 1 ? articulos.map((a) => [a.cantidad, a.unidad, a.material].filter(Boolean).join(' ')).join('\n') : null,
    direccion: colonia,
    foto: solicitudes.obtener(id).foto,
  });
  solicitudes.marcar(id, 'en_nota');
  bus.emit('nota:creada', nota);
  res.status(201).json(nota);
});

router.get('/fotos/:nombre', (req, res) => {
  if (!/^[\w-]+\.(jpg|png|webp|gif)$/.test(req.params.nombre)) throw httpError(404, 'Foto no encontrada');
  res.sendFile(req.params.nombre, { root: solicitudes.DIR_FOTOS });
});

// Los campos del formulario: cliente, telefono, colonia y productos [{ cantidad, unidad, material }].
function solicitudDeCampos(b) {
  const cliente = String(b.cliente ?? '').trim().toUpperCase();
  const colonia = String(b.colonia ?? '').trim();
  const telefonoTexto = String(b.telefono ?? '').trim();
  const telefono = telefonoTexto ? normalizar(telefonoTexto) : null;
  const productos = b.productos
    .map((p) => ({
      cantidad: String(p.cantidad ?? '').trim() || null,
      unidad: unidadDe(String(p.unidad ?? '').trim()) ?? String(p.unidad ?? '').trim(),
      texto: conBolsa(String(p.material ?? '').trim()),
    }))
    .filter((p) => p.texto);
  if (!cliente) throw httpError(400, 'Falta el cliente');
  if (telefonoTexto && !telefono) throw httpError(400, 'Teléfono inválido: escribe los 10 dígitos');
  if (!productos.length) throw httpError(400, 'Falta al menos un artículo');
  if (!colonia) throw httpError(400, 'Falta la colonia (para el flete)');
  return { cliente, telefono, colonia, productos };
}

// Sólo arma la cotización con sus precios para revisarla: aquí no se le manda nada al cliente.
router.post('/borrador', (req, res) => {
  const b = req.body ?? {};
  let solicitud;
  if (Array.isArray(b.productos)) {
    solicitud = solicitudDeCampos(b);
  } else {
    const r = interpretarSolicitud(b.texto);
    if (!r.ok) throw httpError(400, r.error);
    solicitud = r.solicitud;
  }
  res.json(armarBorrador(solicitud, cotizaciones.precios(), cotizaciones.fletePorColonia(solicitud.colonia)));
});

async function enviarPorWhatsapp(cotizacion) {
  const telefono = cotizacion.cliente_telefono;
  let estado;
  if (!telefono) estado = 'sin_telefono';
  else if (!whatsapp.estaListo()) estado = 'desconectado';
  else {
    try {
      const png = await generarPNG(cotizacion);
      const entregado = await whatsapp.enviarImagen(telefono, png, `${cotizacion.folio}.png`, `Cotización ${cotizacion.folio}`);
      estado = entregado ? 'enviado' : 'no_whatsapp';
    } catch (err) {
      console.error(`[inspector] ${cotizacion.folio}:`, err.message);
      estado = 'error';
    }
  }
  cotizaciones.marcarWhatsapp(cotizacion.id, estado);
  return estado;
}

// body: { cliente, telefono?, colonia, solicitud, partidas, actualizarPrecios?, enviar? }
router.post('/', async (req, res) => {
  const b = req.body ?? {};
  const cliente = String(b.cliente ?? '').trim().toUpperCase();
  const colonia = String(b.colonia ?? '').trim();
  if (!cliente || !colonia) throw httpError(400, 'Falta el cliente o la colonia');
  if (!Array.isArray(b.partidas) || !b.partidas.some((p) => p.tipo !== 'flete')) throw httpError(400, 'La cotización no tiene productos');
  const telefonoTexto = String(b.telefono ?? '').trim();
  const telefono = telefonoTexto ? normalizar(telefonoTexto) : null;
  if (telefonoTexto && !telefono) throw httpError(400, 'Teléfono inválido: escribe los 10 dígitos');
  // Desde el Pizarrón aprobar es enviar: si no se puede enviar, la tarjeta se queda como está.
  if (b.solicitud_id) {
    if (!solicitudes.sigueAbierta(Number(b.solicitud_id))) throw httpError(409, 'Esa solicitud ya se atendió');
    if (b.enviar && !telefono) throw httpError(400, 'Falta el WhatsApp del cliente');
    if (b.enviar && !whatsapp.estaListo()) throw httpError(503, 'WhatsApp no está conectado: no se envió nada');
  }

  let calculo;
  try {
    calculo = calcular(b.partidas);
  } catch (err) {
    throw httpError(400, err.message);
  }
  const { cotizacion, aprendido } = cotizaciones.aprobar(
    { cliente, telefono, colonia, solicitud: b.solicitud ?? null, metodo_pago: String(b.metodo_pago ?? '').trim() || null, ...calculo },
    b.actualizarPrecios !== false,
  );
  if (b.solicitud_id) solicitudes.marcar(Number(b.solicitud_id), 'cotizada', cotizacion.id);
  bus.emit('cotizacion:creada', cotizacion);
  const whatsappEstado = b.enviar ? await enviarPorWhatsapp(cotizacion) : null;
  res.status(201).json({ cotizacion: { ...cotizacion, whatsapp: whatsappEstado }, aprendido });
});

router.get('/:id/imagen', async (req, res) => {
  const cotizacion = cotizaciones.obtener(Number(req.params.id));
  if (!cotizacion) throw httpError(404, 'Cotización no encontrada');
  const png = await generarPNG(cotizacion);
  res.type('png');
  if (req.query.descargar) res.attachment(`${cotizacion.folio}.png`);
  res.send(png);
});

router.get('/:id', (req, res) => {
  const cotizacion = cotizaciones.obtener(Number(req.params.id));
  if (!cotizacion) throw httpError(404, 'Cotización no encontrada');
  res.json(cotizacion);
});

// Edición manual desde el historial. body: { partidas, enviar?, cliente?, telefono?, colonia? }. Con enviar,
// sale la imagen corregida por WhatsApp (un humano lo revisó y apretó el botón). El folio nunca cambia.
router.put('/:id', async (req, res) => {
  const b = req.body ?? {};
  let datos = null;
  if (b.cliente !== undefined) {
    const cliente = String(b.cliente ?? '').trim().toUpperCase();
    const colonia = String(b.colonia ?? '').trim();
    if (!cliente || !colonia) throw httpError(400, 'Falta el cliente o la ubicación');
    const telefonoTexto = String(b.telefono ?? '').trim();
    const telefono = telefonoTexto ? normalizar(telefonoTexto) : null;
    if (telefonoTexto && !telefono) throw httpError(400, 'Teléfono inválido: escribe los 10 dígitos');
    datos = { cliente, telefono, colonia };
  }
  if (!Array.isArray(b.partidas) || !b.partidas.some((p) => p.tipo !== 'flete')) throw httpError(400, 'La cotización no tiene productos');
  let calculo;
  try {
    calculo = calcular(b.partidas);
  } catch (err) {
    throw httpError(400, err.message);
  }
  const cotizacion = cotizaciones.editar(Number(req.params.id), calculo, datos);
  if (!cotizacion) throw httpError(404, 'Cotización no encontrada');
  bus.emit('solicitud:nueva');
  const whatsappEstado = b.enviar ? await enviarPorWhatsapp(cotizacion) : null;
  res.json({ cotizacion: { ...cotizacion, whatsapp: whatsappEstado ?? cotizacion.whatsapp }, whatsapp: whatsappEstado });
});

router.post('/:id/enviar', async (req, res) => {
  const cotizacion = cotizaciones.obtener(Number(req.params.id));
  if (!cotizacion) throw httpError(404, 'Cotización no encontrada');
  res.json({ whatsapp: await enviarPorWhatsapp(cotizacion) });
});

// Pagada o Cerrada cancelan el recordatorio de 24 horas; "aprobada" deshace (por si fue un mal clic).
router.post('/:id/estado', (req, res) => {
  const estado = req.body?.estado;
  if (!['aprobada', 'pagada', 'cerrada'].includes(estado)) throw httpError(400, 'Estado inválido');
  if (!cotizaciones.marcarEstado(Number(req.params.id), estado)) throw httpError(404, 'Cotización no encontrada');
  bus.emit('solicitud:nueva');
  res.status(204).end();
});

module.exports = router;
