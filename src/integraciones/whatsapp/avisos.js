// Aviso automático al cliente: "tu pedido va en camino" al pasar a En Ruta. Es el único: el usuario
// no quiere avisos al cargar. Se registra en whatsapp_envios y nunca se manda dos veces para una nota.
const db = require('../../db/connection');
const bus = require('../../events/bus');
const notas = require('../../repositories/notas.repo');
const whatsapp = require('./cliente');
const mensajes = require('./mensajes');

const TIPO = 'en_ruta';

const stmts = {
  previo: db.prepare('SELECT estado FROM whatsapp_envios WHERE nota_id = ? AND tipo = ?'),
  guardar: db.prepare(`
    INSERT INTO whatsapp_envios (nota_id, tipo, telefono, estado, detalle)
    VALUES (@nota_id, @tipo, @telefono, @estado, @detalle)
    ON CONFLICT (nota_id, tipo) DO UPDATE SET
      telefono = excluded.telefono, estado = excluded.estado, detalle = excluded.detalle,
      fecha = datetime('now', 'localtime')`),
  // Avisos que no salieron porque WhatsApp estaba desconectado (sólo los recientes).
  pendientes: db.prepare(`
    SELECT nota_id FROM whatsapp_envios
    WHERE tipo = ? AND estado = 'pendiente' AND fecha >= datetime('now', 'localtime', '-6 hours')`),
};

const enCurso = new Set(); // evita dos envíos simultáneos de la misma nota

function registrar(nota, estado, detalle = null) {
  stmts.guardar.run({ nota_id: nota.id, tipo: TIPO, telefono: nota.cliente_telefono ?? null, estado, detalle });
}

async function avisarEnRuta(nota) {
  if (enCurso.has(nota.id) || stmts.previo.get(nota.id, TIPO)?.estado === 'enviado') return;
  if (!nota.cliente_telefono) return registrar(nota, 'sin_telefono');
  if (!whatsapp.estaListo()) return registrar(nota, 'pendiente', 'WhatsApp desconectado; se enviará al reconectar');

  enCurso.add(nota.id);
  try {
    const entregado = await whatsapp.enviar(nota.cliente_telefono, mensajes.enRuta(nota));
    registrar(nota, entregado ? 'enviado' : 'no_whatsapp', entregado ? null : 'Ese número no tiene WhatsApp');
    console.log(`[whatsapp] ${nota.folio}: ${entregado ? 'aviso enviado' : 'el número no tiene WhatsApp'}`);
  } catch (err) {
    registrar(nota, 'error', err.message);
    console.error(`[whatsapp] ${nota.folio}:`, err.message);
  } finally {
    enCurso.delete(nota.id);
  }
}

function iniciar() {
  bus.on('nota:estado', ({ nota, retroceso }) => {
    if (!retroceso && nota.estado === 'en_ruta') avisarEnRuta(nota);
  });
  // Al reconectar, manda lo que quedó pendiente si la nota sigue En Ruta.
  whatsapp.alConectar(() => {
    for (const { nota_id } of stmts.pendientes.all(TIPO)) {
      const nota = notas.obtenerSiExiste(nota_id);
      if (nota?.estado === 'en_ruta') avisarEnRuta(nota);
    }
  });
}

module.exports = { iniciar };
