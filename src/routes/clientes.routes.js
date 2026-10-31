const express = require('express');
const clientes = require('../repositories/clientes.repo');
const { normalizar } = require('../lib/telefono');
const { httpError } = require('../lib/errors');

const router = express.Router();

router.get('/', (req, res) => res.json(clientes.listar()));

// { telefono: "981 196 5122" } -> se guarda como 529811965122. Vacío = quitar el teléfono.
router.patch('/:id/telefono', (req, res) => {
  const id = Number(req.params.id);
  if (!clientes.obtener(id)) throw httpError(404, 'Cliente no encontrado');
  const texto = String(req.body?.telefono ?? '').trim();
  const telefono = texto ? normalizar(texto) : null;
  if (texto && !telefono) throw httpError(400, 'Teléfono inválido: escribe los 10 dígitos, ej. 981 196 5122');
  res.json(clientes.actualizarTelefono(id, telefono));
});

module.exports = router;
