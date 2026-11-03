// Archivero de Sulema: fotos de notas firmadas por folio o fechas, y cada foto suelta.
// Las que ya se empaquetaron (más de 6 meses) se listan con su .zip, pero no se muestran.
const express = require('express');
const evidencias = require('../integraciones/sulema/evidencias');
const { httpError } = require('../lib/errors');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(evidencias.buscar(req.query).map((e) => ({ ...e, foto: e.paquete ? null : `/api/evidencias/${e.id}/foto` })));
});

router.get('/:id/foto', (req, res) => {
  const e = evidencias.obtener(Number(req.params.id));
  if (!e) throw httpError(404, 'Evidencia no encontrada');
  if (e.paquete) throw httpError(410, `Ya está empaquetada en ${e.paquete}`);
  res.sendFile(e.archivo, { root: evidencias.CARPETA, dotfiles: 'deny' });
});

module.exports = router;
