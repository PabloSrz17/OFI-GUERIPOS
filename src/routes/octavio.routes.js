// Octavio: órdenes de compra por aprobar y en su pizarrón, y entradas de almacén.
const express = require('express');
const ordenes = require('../integraciones/octavio/ordenes');
const whatsapp = require('../integraciones/whatsapp/cliente');
const { generarOrdenPNG } = require('../integraciones/inspector/imagen');
const { normalizar } = require('../lib/telefono');
const { httpError } = require('../lib/errors');

const router = express.Router();

// Lo que se puede cambiar de una orden: en la alerta y en el pizarrón.
function datosDe(b) {
  const texto = String(b.telefono ?? '').trim();
  const telefono = texto ? normalizar(texto) : null;
  if (texto && !telefono) throw httpError(400, 'Teléfono inválido: escribe los 10 dígitos');
  const solicitante = String(b.solicitante ?? '').trim().toUpperCase();
  if (!solicitante) throw httpError(400, 'Falta quién la solicita');
  let renglones;
  try {
    renglones = ordenes.validarRenglones(b.renglones);
  } catch (err) {
    throw httpError(400, err.message);
  }
  return { telefono, solicitante, sucursal: String(b.sucursal ?? '').trim() || 'Concordia', renglones };
}

function ordenDe(req) {
  const orden = ordenes.obtener(Number(req.params.id));
  if (!orden) throw httpError(404, 'Orden no encontrada');
  return orden;
}

router.get('/ordenes', (req, res) => res.json(ordenes.listar()));

// Orden de compra capturada en el panel (sin folio): queda Aprobada en "Órdenes de Compra Almacén".
router.post('/ordenes', (req, res) => {
  try {
    res.status(201).json(ordenes.crearManual(req.body ?? {}));
  } catch (err) {
    throw httpError(400, err.message);
  }
});

// Aprobar es contestar: si no se puede enviar, la alerta se queda como está.
router.post('/ordenes/:id/aprobar', async (req, res) => {
  const id = ordenDe(req).id;
  const datos = datosDe(req.body ?? {});
  if (!datos.telefono) throw httpError(400, 'Falta el WhatsApp de quien la pidió');
  if (!whatsapp.estaListo()) throw httpError(503, 'WhatsApp no está conectado: no se aprobó ni se envió nada');
  if (!ordenes.aprobar(id, datos)) throw httpError(409, 'Esa orden ya se atendió');
  const orden = ordenes.obtener(id);
  res.json({ orden, whatsapp: await ordenes.responder(orden) });
});

router.post('/ordenes/:id/descartar', (req, res) => {
  if (!ordenes.descartar(ordenDe(req).id)) throw httpError(409, 'Esa orden ya se atendió');
  res.status(204).end();
});

// Editar en el pizarrón no le avisa a nadie.
router.put('/ordenes/:id', (req, res) => {
  const id = ordenDe(req).id;
  try {
    if (!ordenes.editar(id, { ...datosDe(req.body ?? {}), nota: req.body?.nota, estado: req.body?.estado })) throw httpError(409, 'Esa orden todavía no está en el pizarrón');
  } catch (err) {
    throw err.status ? err : httpError(400, err.message);
  }
  res.json(ordenes.obtener(id));
});

// Sólo desde la columna Canceladas.
router.delete('/ordenes/:id', (req, res) => {
  if (!ordenes.eliminar(ordenDe(req).id)) throw httpError(409, 'Sólo se eliminan órdenes canceladas');
  res.status(204).end();
});

router.patch('/ordenes/:id/estado', (req, res) => {
  const id = ordenDe(req).id;
  try {
    if (!ordenes.mover(id, req.body?.estado)) throw httpError(409, 'Esa orden todavía no está en el pizarrón');
  } catch (err) {
    throw err.status ? err : httpError(400, err.message);
  }
  res.json(ordenes.obtener(id));
});

router.post('/ordenes/:id/enviar', async (req, res) => {
  const orden = ordenDe(req);
  if (orden.estado !== 'aprobada') throw httpError(409, 'Sólo se reenvían órdenes aprobadas');
  res.json({ whatsapp: await ordenes.responder(orden) });
});

router.get('/ordenes/:id/imagen', async (req, res) => {
  res.type('png').send(await generarOrdenPNG(ordenDe(req)));
});

router.get('/entradas', (req, res) => res.json(ordenes.entradas()));

// Hoja impresa (/entradas.html): entradas entre dos fechas, máximo un año.
router.get('/entradas/rango', (req, res) => {
  const fecha = /^\d{4}-\d{2}-\d{2}$/;
  const { desde, hasta } = req.query;
  if (!fecha.test(desde ?? '') || !fecha.test(hasta ?? '') || desde > hasta) throw httpError(400, 'Fechas inválidas');
  if ((new Date(hasta) - new Date(desde)) / 86_400_000 > 366) throw httpError(400, 'Máximo un año por hoja');
  res.json(ordenes.entradasEntre(desde, hasta));
});

router.post('/entradas', (req, res) => {
  try {
    ordenes.registrarEntrada(req.body ?? {});
  } catch (err) {
    throw httpError(400, err.message);
  }
  res.status(201).end();
});

router.put('/entradas/:id', (req, res) => {
  let hecho;
  try {
    hecho = ordenes.editarEntrada(Number(req.params.id), req.body ?? {});
  } catch (err) {
    throw httpError(400, err.message);
  }
  if (!hecho) throw httpError(404, 'Entrada no encontrada');
  res.status(204).end();
});

module.exports = router;
