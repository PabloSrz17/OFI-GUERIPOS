// Reporte semanal: GET /api/reportes/semanal?dia=AAAA-MM-DD (cualquier día de la semana; sin él, la actual).
const express = require('express');
const reporte = require('../repositories/reporte.repo');
const { httpError } = require('../lib/errors');

const router = express.Router();

router.get('/semanal', (req, res) => {
  const dia = req.query.dia;
  if (dia !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw httpError(400, 'Fecha inválida: usa AAAA-MM-DD');
  res.json(reporte.generar(dia));
});

module.exports = router;
