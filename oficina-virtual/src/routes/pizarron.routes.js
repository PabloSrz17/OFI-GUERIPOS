// Pizarrón de la Oficina (chalkboard): pendientes del equipo. Cada cambio se avisa por el bus
// ('pizarron:cambio') para que todas las pantallas se actualicen al instante.
const express = require('express');
const db = require('../db/connection');
const bus = require('../events/bus');
const { httpError } = require('../lib/errors');

const router = express.Router();
const stmts = {
  // Pendientes primero; los completados de hoy al final (los de días anteriores ya no se muestran).
  listar: db.prepare(`
    SELECT * FROM chalkboard
    WHERE estado = 'pendiente' OR date(completado_en) = date('now', 'localtime')
    ORDER BY estado = 'completado', id DESC`),
  porId: db.prepare('SELECT * FROM chalkboard WHERE id = ?'),
  crear: db.prepare('INSERT INTO chalkboard (texto, creado_por) VALUES (?, ?)'),
  estado: db.prepare(`
    UPDATE chalkboard SET estado = ?,
      completado_en = CASE WHEN ? = 'completado' THEN datetime('now', 'localtime') END
    WHERE id = ?`),
  borrar: db.prepare('DELETE FROM chalkboard WHERE id = ?'),
};

const avisar = () => bus.emit('pizarron:cambio');

router.get('/', (req, res) => res.json(stmts.listar.all()));

router.post('/', (req, res) => {
  const texto = String(req.body?.texto ?? '').trim();
  if (!texto || texto.length > 300) throw httpError(400, 'Escribe la nota (máximo 300 caracteres)');
  const creador = String(req.body?.creado_por ?? '').trim().slice(0, 40) || null;
  const { lastInsertRowid } = stmts.crear.run(texto, creador);
  avisar();
  res.status(201).json(stmts.porId.get(lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const estado = req.body?.estado;
  if (!['pendiente', 'completado'].includes(estado)) throw httpError(400, 'Estado inválido');
  if (!stmts.estado.run(estado, estado, Number(req.params.id)).changes) throw httpError(404, 'Nota no encontrada');
  avisar();
  res.json(stmts.porId.get(Number(req.params.id)));
});

router.delete('/:id', (req, res) => {
  if (!stmts.borrar.run(Number(req.params.id)).changes) throw httpError(404, 'Nota no encontrada');
  avisar();
  res.status(204).end();
});

module.exports = router;
