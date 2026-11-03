// Reportes: GET /api/reportes/semanal?dia=AAAA-MM-DD (cualquier día de la semana; sin él, la actual)
// y GET /api/reportes/dia?dia=AAAA-MM-DD (archivero de Edgar; sin él, hoy).
const express = require('express');
const reporte = require('../repositories/reporte.repo');
const { httpError } = require('../lib/errors');

const router = express.Router();

function diaDe(req) {
  const dia = req.query.dia;
  if (dia !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw httpError(400, 'Fecha inválida: usa AAAA-MM-DD');
  return dia;
}

router.get('/semanal', (req, res) => res.json(reporte.generar(diaDe(req))));
router.get('/dia', (req, res) => res.json(reporte.delDia(diaDe(req))));
// Control de Gasolina: ?desde=&hasta=&unidad=&min=&max= (todos opcionales).
router.get('/combustible', (req, res) => res.json(reporte.bitacoraCombustible(req.query)));
// Carga anotada a mano: { unidad, importe, concepto: gasolina|diesel, litros? }.
router.post('/combustible', (req, res) => {
  const { unidad, importe, concepto = 'gasolina', litros } = req.body ?? {};
  const nombre = String(unidad ?? '').trim().toUpperCase().slice(0, 60);
  const monto = Number(importe);
  const lts = litros === undefined || litros === '' ? null : Number(litros);
  if (!nombre) throw httpError(400, 'Falta la unidad');
  if (!(monto > 0)) throw httpError(400, 'El importe debe ser mayor a 0');
  if (!['gasolina', 'diesel'].includes(concepto)) throw httpError(400, 'Concepto inválido');
  if (lts !== null && !(lts >= 0)) throw httpError(400, 'Litros inválidos');
  res.status(201).json(reporte.anotarCombustible({ unidad: nombre, importe: monto, concepto, litros: lts || null }));
});

module.exports = router;
