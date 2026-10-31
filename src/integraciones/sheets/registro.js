// Respaldo contable: al marcar una nota como Entregado se agrega una fila a la hoja de Google
// (Apps Script publicado como aplicación web). Una sola fila por nota; si falla o no hay internet,
// se reintenta cada 5 minutos durante 7 días. Si después se cancela, se regresa o se edita la nota,
// su renglón se borra o se actualiza. La hoja sólo lleva entregas: lo pendiente nunca se escribe.
const db = require('../../db/connection');
const bus = require('../../events/bus');
const notas = require('../../repositories/notas.repo');
const estado = require('../estado');
const { sheets: config } = require('../../config');
const { materialesDeNota } = require('./abreviar');

const ORIGEN = 'sheets';
const REINTENTO_MS = 5 * 60_000;

const stmts = {
  previo: db.prepare('SELECT estado FROM sheets_registros WHERE nota_id = ?'),
  guardar: db.prepare(`
    INSERT INTO sheets_registros (nota_id, estado, detalle, folio_hoja, fecha_hoja) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (nota_id) DO UPDATE SET estado = excluded.estado, detalle = excluded.detalle,
      folio_hoja = excluded.folio_hoja, fecha_hoja = excluded.fecha_hoja,
      fecha = datetime('now', 'localtime')`),
  quitar: db.prepare('DELETE FROM sheets_registros WHERE nota_id = ?'),
  renombrar: db.prepare('UPDATE sheets_registros SET folio_hoja = ? WHERE nota_id = ?'),
  encolar: db.prepare('INSERT INTO sheets_cambios (accion, fecha, folio, nuevo) VALUES (?, ?, ?, ?)'),
  siguiente: db.prepare('SELECT * FROM sheets_cambios ORDER BY id LIMIT 1'),
  aplicado: db.prepare('DELETE FROM sheets_cambios WHERE id = ?'),
  vencidos: db.prepare(`DELETE FROM sheets_cambios WHERE creado_en < datetime('now', 'localtime', '-7 days')`),
  porReintentar: db.prepare(`
    SELECT s.nota_id FROM sheets_registros s JOIN notas n ON n.id = s.nota_id
    WHERE s.estado IN ('pendiente', 'error') AND n.estado = 'entregado'
      AND n.actualizado_en >= datetime('now', 'localtime', '-7 days')`),
};

const enCurso = new Set();

// Cómo aparece cada chofer en la hoja de reparto (como ya lo anotaban a mano).
const CHOFER_EN_HOJA = { 'MOISES SOSA': 'SOSA' };

// Datos de un renglón de la hoja "FORMATO DE REPARTO" (ver scripts/google-sheets/Codigo.gs):
// CHOFER | NOTA | CLIENTE | cemento (D) | demás materiales (E en adelante), bajo la franja del día.
function fila(nota) {
  const chofer = String(nota.chofer ?? '').toUpperCase();
  return {
    fecha: nota.actualizado_en.slice(0, 10), // día de la entrega
    chofer: CHOFER_EN_HOJA[chofer] ?? chofer,
    nota: nota.folio,
    cliente: nota.cliente,
    ...materialesDeNota(nota),
  };
}

async function enviar(cuerpo) {
  const respuesta = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: config.token, ...cuerpo }),
    redirect: 'follow', // Apps Script responde con una redirección
    signal: AbortSignal.timeout(30_000),
  });
  const texto = await respuesta.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* respuesta no JSON: se reporta abajo */ }
  if (!respuesta.ok || !json?.ok) {
    throw new Error(json?.error ? `la hoja respondió: ${json.error}` : `respuesta inesperada (HTTP ${respuesta.status})`);
  }
}

async function registrar(nota) {
  if (nota.es_almacen) { // la hoja es de reparto: lo que se recoge en almacén no va, y si ya estaba, sale
    if (nota.sheets) alRegresar(nota);
    return;
  }
  if (enCurso.has(nota.id) || stmts.previo.get(nota.id)?.estado === 'registrado') return;
  if (!config.url) {
    stmts.guardar.run(nota.id, 'pendiente', 'Google Sheets sin configurar', null, null);
    return;
  }
  enCurso.add(nota.id);
  const datos = fila(nota);
  try {
    await aplicarCambios(); // primero lo pendiente: un borrado atrasado no debe tumbar este renglón
    await enviar({ fila: datos });
    // Pudieron cancelarla, regresarla o pasarla a ALMACÉN mientras se escribía: ese renglón ya no debe estar.
    const actual = notas.obtenerSiExiste(nota.id);
    if (actual?.estado !== 'entregado' || actual.es_almacen) {
      stmts.encolar.run('borrar', datos.fecha, nota.folio, null);
      aplicarCambios();
      return;
    }
    stmts.guardar.run(nota.id, 'registrado', null, nota.folio, datos.fecha);
    const ahora = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    estado.reportar(ORIGEN, true, `Último registro: ${nota.folio} · ${ahora}`);
    console.log(`[sheets] ${nota.folio}: registrada`);
  } catch (err) {
    if (notas.obtenerSiExiste(nota.id)) stmts.guardar.run(nota.id, 'error', err.message, null, null);
    estado.reportar(ORIGEN, false, `No pude registrar ${nota.folio}: ${err.message}`);
    console.error(`[sheets] ${nota.folio}:`, err.message);
  } finally {
    enCurso.delete(nota.id);
  }
}

// Aplica en orden los cambios a renglones ya escritos. Si uno falla, espera a la siguiente vuelta.
let aplicando = null;
function aplicarCambios() {
  aplicando ??= correrCambios().finally(() => { aplicando = null; });
  return aplicando;
}

async function correrCambios() {
  try {
    let cambio;
    while ((cambio = stmts.siguiente.get())) {
      await enviar({ accion: cambio.accion, fecha: cambio.fecha, nota: cambio.folio, nuevo: cambio.nuevo && JSON.parse(cambio.nuevo) });
      stmts.aplicado.run(cambio.id);
      estado.reportar(ORIGEN, true, `Hoja al día: ${cambio.folio} · ${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`);
      console.log(`[sheets] ${cambio.folio}: renglón ${cambio.accion === 'borrar' ? 'borrado' : 'actualizado'}`);
    }
  } catch (err) {
    // Un script viejo responde esto a lo que no conoce: falta publicar la versión nueva.
    const mensaje = /fila sin fecha/.test(err.message) ? 'Falta publicar la versión nueva del script de la hoja' : err.message;
    estado.reportar(ORIGEN, false, `Cambios en espera: ${mensaje}`);
    console.error('[sheets] cambios en espera:', mensaje);
  }
}

function borrarRenglon(nota) {
  stmts.encolar.run('borrar', nota.sheets_fecha ?? nota.actualizado_en.slice(0, 10), nota.sheets_folio ?? nota.folio, null);
  aplicarCambios();
}

function alRegresar(nota) {
  if (nota.sheets === 'registrado') borrarRenglon(nota);
  stmts.quitar.run(nota.id); // al volver a entregarla se escribe de nuevo
}

function alEditar(nota) {
  if (nota.sheets !== 'registrado') return;
  if (nota.es_almacen) { // la hoja es de reparto
    alRegresar(nota);
    return;
  }
  const fecha = nota.sheets_fecha ?? nota.actualizado_en.slice(0, 10);
  stmts.encolar.run('actualizar', fecha, nota.sheets_folio ?? nota.folio, JSON.stringify({ ...fila(nota), fecha }));
  stmts.renombrar.run(nota.folio, nota.id);
  aplicarCambios();
}

async function reintentar() {
  stmts.vencidos.run();
  aplicarCambios();
  for (const { nota_id } of stmts.porReintentar.all()) {
    const nota = notas.obtenerSiExiste(nota_id);
    if (nota) await registrar(nota);
  }
}

function iniciar() {
  estado.reportar(ORIGEN, config.url ? true : null,
    config.url ? 'Listo para registrar entregas' : 'Sin configurar (SHEETS_URL en .env)');
  bus.on('nota:estado', ({ nota, retroceso, anterior }) => {
    if (!retroceso && nota.estado === 'entregado') registrar(nota);
    if (retroceso && anterior === 'entregado') alRegresar(nota);
  });
  bus.on('nota:eliminada', (nota) => { if (nota.sheets === 'registrado') borrarRenglon(nota); });
  bus.on('nota:editada', alEditar);
  // Elegir ALMACÉN en el selector de la tarjeta, en una nota que ya tenía renglón.
  bus.on('nota:asignada', (nota) => { if (nota.es_almacen && nota.sheets) alRegresar(nota); });
  if (config.url) {
    reintentar();
    setInterval(reintentar, REINTENTO_MS).unref();
  }
}

module.exports = { iniciar, fila, aplicarCambios };
