// 💬 WhatsApp de Chatito en esta PC (el servidor): el botón de la Oficina trae su ventana al frente.
// Sólo desde esta PC: quien la usa escribe con el número del negocio. Las otras abren su propio WhatsApp Web.
const express = require('express');
const seguridad = require('../lib/seguridad');
const whatsapp = require('../integraciones/whatsapp/cliente');
const { httpError } = require('../lib/errors');

const router = express.Router();
router.post('/ventana', async (req, res) => {
  if (!seguridad.esEstaPC(req)) throw httpError(403, 'Sólo desde la PC de la Oficina');
  let abierto;
  try {
    abierto = await whatsapp.mostrarVentana(req.body?.telefono);
  } catch (err) {
    throw err.status ? httpError(err.status, err.message) : err;
  }
  if (!abierto) throw httpError(404, 'Ese número no tiene WhatsApp');
  res.json({ ok: true });
});

module.exports = router;
