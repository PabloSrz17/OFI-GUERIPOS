const express = require('express');
const asistencias = require('../repositories/asistencias.repo');
const bus = require('../events/bus');

const router = express.Router();

// ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD
router.get('/', (req, res) => res.json(asistencias.semana(String(req.query.desde), String(req.query.hasta))));

// body: { trabajador_id, fecha, estado: "asistio" | "falta" | null }
router.put('/', (req, res) => {
  const { trabajador_id: id, fecha, estado = null } = req.body ?? {};
  asistencias.marcar(Number(id), String(fecha), estado);
  bus.emit('asistencia:cambio');
  res.status(204).end();
});

module.exports = router;
