// Aviso automático al cliente: "tu pedido va en camino" al pasar a En Ruta. Es el único: el usuario
// no quiere avisos al cargar. Se registra en whatsapp_envios y nunca se manda dos veces para una nota.
// Varias notas del mismo número en la misma unidad y viaje salen en UN solo mensaje: al pasar a En Ruta
// se espera un momento (config.esperaMs) por si se mandan las demás; cada nota nueva reinicia la espera.
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
const config = { esperaMs: 60_000, maximoMs: 5 * 60_000 };
const grupos = new Map(); // "telefono|camion|viaje" -> { ids, timer, desde }

const claveDe = (n) => `${n.cliente_telefono}|${n.camion_id ?? ''}|${n.viaje ?? 1}`;

function registrar(nota, estado, detalle = null) {
  stmts.guardar.run({ nota_id: nota.id, tipo: TIPO, telefono: nota.cliente_telefono ?? null, estado, detalle });
}

const yaEnviada = (id) => stmts.previo.get(id, TIPO)?.estado === 'enviado';

function avisarEnRuta(nota) {
  if (enCurso.has(nota.id) || yaEnviada(nota.id)) return;
  if (!nota.cliente_telefono) return registrar(nota, 'sin_telefono');
  if (!whatsapp.estaListo()) return registrar(nota, 'pendiente', 'WhatsApp desconectado; se enviará al reconectar');

  // A la espera de las demás notas del mismo cliente en ese viaje.
  const clave = claveDe(nota);
  const grupo = grupos.get(clave) ?? { ids: new Set(), timer: null, desde: Date.now() };
  grupo.ids.add(nota.id);
  clearTimeout(grupo.timer);
  const espera = Math.max(0, Math.min(config.esperaMs, grupo.desde + config.maximoMs - Date.now()));
  grupo.timer = setTimeout(() => enviarGrupo(clave), espera);
  grupo.timer.unref?.();
  grupos.set(clave, grupo);
}

async function enviarGrupo(clave) {
  const grupo = grupos.get(clave);
  grupos.delete(clave);
  // Sólo las que siguen En Ruta y no se han avisado (alguna pudo regresar o borrarse en la espera).
  const lista = [...(grupo?.ids ?? [])]
    .map((id) => notas.obtenerSiExiste(id))
    .filter((n) => n && n.estado === 'en_ruta' && !yaEnviada(n.id) && !enCurso.has(n.id));
  if (!lista.length) return;
  const folios = lista.map((n) => n.folio).join(', ');
  lista.forEach((n) => enCurso.add(n.id));
  try {
    if (!whatsapp.estaListo()) {
      lista.forEach((n) => registrar(n, 'pendiente', 'WhatsApp desconectado; se enviará al reconectar'));
      return;
    }
    const texto = lista.length === 1 ? mensajes.enRuta(lista[0]) : mensajes.enRutaVarias(lista);
    const entregado = await whatsapp.enviar(lista[0].cliente_telefono, texto);
    lista.forEach((n) => registrar(n, entregado ? 'enviado' : 'no_whatsapp', entregado ? null : 'Ese número no tiene WhatsApp'));
    console.log(`[whatsapp] ${folios}: ${entregado ? (lista.length > 1 ? 'un solo aviso enviado' : 'aviso enviado') : 'el número no tiene WhatsApp'}`);
  } catch (err) {
    lista.forEach((n) => registrar(n, 'error', err.message));
    console.error(`[whatsapp] ${folios}:`, err.message);
  } finally {
    lista.forEach((n) => enCurso.delete(n.id));
  }
}

function iniciar() {
  bus.on('nota:estado', ({ nota, retroceso, sinAviso }) => {
    if (retroceso || nota.estado !== 'en_ruta') return;
    // "No avisar al cliente": queda anotado y no se manda, ni al reconectar.
    if (sinAviso) registrar(nota, 'sin_aviso', 'Se pidió no avisar al cliente');
    else avisarEnRuta(nota);
  });
  // Al reconectar, manda lo que quedó pendiente si la nota sigue En Ruta.
  whatsapp.alConectar(() => {
    for (const { nota_id } of stmts.pendientes.all(TIPO)) {
      const nota = notas.obtenerSiExiste(nota_id);
      if (nota?.estado === 'en_ruta') avisarEnRuta(nota);
    }
  });
}

module.exports = { iniciar, config };
