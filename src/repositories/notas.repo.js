const db = require('../db/connection');
const { httpError } = require('../lib/errors');
const { renglonesVentana, dividir, armar } = require('../lib/parcial');

const ESTADOS = ['pendiente', 'cargando', 'en_ruta', 'entregado'];
// Nota que entró de Pulpos sin dirección ("Sin dirección (ver en Pulpos)"): no puede salir a ruta.
const sinDireccion = (nota) => /^sin direcci[oó]n/i.test(nota.direccion ?? '');
// Avance paso a paso; para corregir un clic equivocado se puede regresar un paso.
const SIGUIENTE = { pendiente: 'cargando', cargando: 'en_ruta', en_ruta: 'entregado' };
const ANTERIOR = Object.fromEntries(Object.entries(SIGUIENTE).map(([de, a]) => [a, de]));
// El cliente que recoge en ALMACÉN no pasa por En Ruta: no sale camión ni se le avisa "va en camino".
const siguienteDe = (nota) => (nota.es_almacen && nota.estado === 'cargando' ? 'entregado' : SIGUIENTE[nota.estado]);
const anteriorDe = (nota) => (nota.es_almacen && nota.estado === 'entregado' ? 'cargando' : ANTERIOR[nota.estado]);
// Estados en los que todavía se puede asignar o cambiar el chofer.
const CHOFER_EDITABLE = ['pendiente', 'cargando'];

const SELECT_NOTA = `
  SELECT n.*,
         c.nombre   AS cliente,
         COALESCE(n.telefono, c.telefono) AS cliente_telefono,
         ch.nombre  AS chofer,
         COALESCE(ch.almacen, 0) AS es_almacen,
         COALESCE(ca.nombre, ch.unidad) AS camion,   -- notas viejas: unidad fija del chofer
         (SELECT w.estado FROM whatsapp_envios w WHERE w.nota_id = n.id AND w.tipo = 'en_ruta') AS whatsapp,
         (SELECT s.estado FROM sheets_registros s WHERE s.nota_id = n.id) AS sheets,
         (SELECT s.folio_hoja FROM sheets_registros s WHERE s.nota_id = n.id) AS sheets_folio,
         (SELECT s.fecha_hoja FROM sheets_registros s WHERE s.nota_id = n.id) AS sheets_fecha
  FROM notas n
  JOIN clientes c ON c.id = n.cliente_id
  LEFT JOIN choferes ch ON ch.id = n.chofer_id
  LEFT JOIN camiones ca ON ca.id = n.camion_id`;

const stmts = {
  // El tablero muestra todo lo activo y sólo lo entregado hoy que no se ha archivado con el cierre.
  tablero: db.prepare(`${SELECT_NOTA}
    WHERE n.estado <> 'entregado' OR (date(n.actualizado_en) = date('now', 'localtime') AND n.archivada_en IS NULL)
    ORDER BY n.creado_en, n.id`),
  // Historial general: todo lo entregado que ya no está en el tablero.
  historial_general: db.prepare(`${SELECT_NOTA}
    WHERE n.estado = 'entregado' AND (n.archivada_en IS NOT NULL OR date(n.actualizado_en) < date('now', 'localtime'))
    ORDER BY n.actualizado_en DESC, n.id DESC LIMIT 200`),
  archivar: db.prepare(`
    UPDATE notas SET archivada_en = datetime('now', 'localtime') WHERE estado = 'entregado' AND archivada_en IS NULL`),
  porId: db.prepare(`${SELECT_NOTA} WHERE n.id = ?`),
  insertar: db.prepare(`
    INSERT INTO notas (origen, folio, id_externo, cliente_id, material, cantidad, unidad, detalle,
                       total, direccion, zona, chofer_id, foto, telefono, etiqueta, creado_en)
    VALUES (@origen, @folio, @id_externo, @cliente_id, @material, @cantidad, @unidad, @detalle,
            @total, @direccion, @zona, @chofer_id, @foto, @telefono, @etiqueta, COALESCE(@creado_en, datetime('now', 'localtime')))`),
  ponerEtiqueta: db.prepare('UPDATE notas SET etiqueta = ? WHERE id = ?'),
  ponerTelefono: db.prepare(`UPDATE notas SET telefono = ?, actualizado_en = datetime('now', 'localtime') WHERE id = ?`),
  actualizarEstado: db.prepare(`
    UPDATE notas SET estado = ?, actualizado_en = datetime('now', 'localtime') WHERE id = ?`),
  asignar: {
    chofer: db.prepare(`
      UPDATE notas SET chofer_id = ?, actualizado_en = datetime('now', 'localtime') WHERE id = ?`),
    camion: db.prepare(`
      UPDATE notas SET camion_id = ?, actualizado_en = datetime('now', 'localtime') WHERE id = ?`),
  },
  editar: db.prepare(`
    UPDATE notas SET folio = @folio, cliente_id = @cliente_id, cantidad = @cantidad, unidad = @unidad,
                     material = @material, detalle = @detalle, total = @total, direccion = @direccion,
                     zona = @zona, chofer_id = @chofer_id, camion_id = @camion_id, telefono = @telefono,
                     actualizado_en = datetime('now', 'localtime')
    WHERE id = @id`),
  partes: db.prepare(`
    UPDATE notas SET cantidad = @cantidad, unidad = @unidad, material = @material, detalle = @detalle,
                     actualizado_en = datetime('now', 'localtime')
    WHERE id = @id`),
  marcarSaldo: db.prepare(`
    UPDATE notas SET saldo = 1, estado = 'pendiente', chofer_id = NULL, camion_id = NULL,
                     actualizado_en = datetime('now', 'localtime')
    WHERE id = ?`),
  reprogramar: db.prepare(`UPDATE notas SET saldo = 0, actualizado_en = datetime('now', 'localtime') WHERE id = ?`),
  folioOcupado: db.prepare('SELECT 1 FROM notas WHERE origen = ? AND folio = ?'),
  saldosDe: db.prepare('SELECT id, folio FROM notas WHERE origen = ? AND saldo = 1 AND id <> ? ORDER BY id'),
  sumarTotal: db.prepare('UPDATE notas SET total = COALESCE(total, 0) + ? WHERE id = ?'),
  esAlmacen: db.prepare('SELECT 1 FROM choferes WHERE id = ? AND almacen = 1'),
  eliminar: db.prepare('DELETE FROM notas WHERE id = ?'),
  historial: db.prepare(`
    INSERT INTO historial_estados (nota_id, estado_anterior, estado_nuevo) VALUES (?, ?, ?)`),
  resumen: db.prepare(`
    SELECT
      COALESCE(SUM(estado = 'pendiente' AND saldo = 0), 0) AS pendiente,
      COALESCE(SUM(saldo = 1), 0) AS saldos,
      COALESCE(SUM(estado = 'cargando'), 0)  AS cargando,
      COALESCE(SUM(estado = 'en_ruta'), 0)   AS en_ruta,
      COALESCE(SUM(estado = 'entregado' AND archivada_en IS NULL AND date(actualizado_en) = date('now', 'localtime')), 0) AS entregado_hoy,
      COALESCE(SUM(estado = 'pendiente' AND saldo = 0 AND (chofer_id IS NULL OR (camion_id IS NULL
        AND chofer_id NOT IN (SELECT id FROM choferes WHERE almacen = 1)))), 0) AS sin_chofer
    FROM notas`),
};

function obtener(id) {
  const nota = stmts.porId.get(id);
  if (!nota) throw httpError(404, 'Nota no encontrada');
  return nota;
}

// creado_en: hora en que se hizo la venta en el sistema de origen (null = ahora).
const OPCIONALES = {
  origen: 'manual', id_externo: null, unidad: 'm³', detalle: null, total: null, zona: null, chofer_id: null, foto: null, telefono: null, etiqueta: null, creado_en: null,
};

const crear = db.transaction((datos) => {
  const { lastInsertRowid } = stmts.insertar.run({ ...OPCIONALES, ...datos });
  stmts.historial.run(lastInsertRowid, null, 'pendiente');
  return stmts.porId.get(lastInsertRowid);
});

const cambiarEstado = db.transaction((id, nuevo) => {
  const nota = obtener(id);
  if (nota.saldo) throw httpError(409, `${nota.folio}: primero re-prográmala en Pendientes`);
  if (!ESTADOS.includes(nuevo)) throw httpError(400, `Estado inválido: ${nuevo}`);
  if (siguienteDe(nota) !== nuevo) {
    throw httpError(409, `No se puede pasar de "${nota.estado}" a "${nuevo}"`);
  }
  if (['cargando', 'en_ruta'].includes(nuevo) && (!nota.chofer_id || (!nota.camion_id && !nota.es_almacen))) {
    throw httpError(409, 'Asigna chofer y camión, o elige ALMACÉN');
  }
  if (nuevo === 'en_ruta' && sinDireccion(nota)) throw httpError(409, `${nota.folio}: falta la dirección de entrega`);
  stmts.actualizarEstado.run(nuevo, id);
  stmts.historial.run(id, nota.estado, nuevo);
  return { nota: stmts.porId.get(id), anterior: nota.estado };
});

// Deshace el último avance (ej. En Ruta → Cargando). Queda en el historial.
const regresar = db.transaction((id) => {
  const nota = obtener(id);
  const previo = anteriorDe(nota);
  if (!previo) throw httpError(409, 'Una nota pendiente no tiene paso anterior');
  stmts.actualizarEstado.run(previo, id);
  stmts.historial.run(id, nota.estado, previo);
  return { nota: stmts.porId.get(id), anterior: nota.estado };
});

// campo: 'chofer' | 'camion'. Se elige por separado: no siempre va el mismo chofer en el mismo camión.
function asignar(id, campo, valorId) {
  const nombre = campo === 'chofer' ? 'El chofer' : 'El camión';
  const nota = obtener(id);
  if (!CHOFER_EDITABLE.includes(nota.estado)) throw httpError(409, `${nombre} sólo se cambia antes de salir a ruta`);
  if (campo === 'camion' && nota.es_almacen) {
    if (valorId) throw httpError(409, 'Una nota de ALMACÉN no lleva camión');
    return nota;
  }
  if (!valorId && nota.estado === 'cargando') throw httpError(409, `Una nota cargando necesita ${campo === 'chofer' ? 'chofer' : 'camión'}`);
  stmts.asignar[campo].run(valorId, id);
  if (campo === 'chofer' && valorId && stmts.esAlmacen.get(valorId)) stmts.asignar.camion.run(null, id);
  return stmts.porId.get(id);
}

// Corrige cualquier dato de la nota, en cualquier estado. La hoja de reparto no se actualiza:
// a una entregada ya se le escribió su renglón.
function editar(id, datos) {
  const nota = obtener(id);
  const almacen = Boolean(datos.chofer_id && stmts.esAlmacen.get(datos.chofer_id));
  if (nota.estado !== 'pendiente' && (!datos.chofer_id || (!datos.camion_id && !almacen))) {
    throw httpError(409, 'Después de Pendiente la nota necesita chofer y camión, o ALMACÉN');
  }
  try {
    stmts.editar.run({ telefono: nota.telefono, ...datos, camion_id: almacen ? null : datos.camion_id, id });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw httpError(409, `Ya hay otra nota con el folio ${datos.folio}`);
    throw err;
  }
  return stmts.porId.get(id);
}

// Cierre de Jornada: lo entregado pasa al historial. Pendiente, Saldos, Cargando y En Ruta no se tocan.
const cerrarJornada = db.transaction(() => {
  const { pendiente, saldos, cargando, en_ruta: enRuta, entregado_hoy: archivadas } = stmts.resumen.get();
  stmts.archivar.run(); // también las de días pasados, que ya no se veían en el tablero
  return { archivadas, conservadas: { pendiente, saldos, cargando, enRuta } };
});

// Folio del saldo: el original con -S1, -S2… La hoja de reparto ubica cada renglón por folio y día,
// y la base no admite dos notas con el mismo folio.
const folioBase = (folio) => folio.replace(/-S\d+$/i, '');
function folioDeSaldo({ origen, folio }) {
  const base = folioBase(folio);
  for (let n = 1; ; n++) {
    if (!stmts.folioOcupado.get(origen, `${base}-S${n}`)) return `${base}-S${n}`;
  }
}

// Las tarjetas de Saldos Pendientes que salieron del mismo folio que esta nota.
const hermanasDe = (nota) => stmts.saldosDe.all(nota.origen, nota.id)
  .filter((s) => folioBase(s.folio) === folioBase(nota.folio))
  .map((s) => stmts.porId.get(s.id));

// Cierra tarjetas de saldo cuyo material ya quedó en otra nota. Su total, si traía, no se pierde.
function cerrarSaldos(lista, destinoId) {
  for (const s of lista) {
    if (s.total) stmts.sumarTotal.run(s.total, destinoId);
    stmts.eliminar.run(s.id);
  }
}

// Ajusta el viaje contra su saldo: lo que suba se resta de la tarjeta de Saldos y lo que baje se le
// suma; si el viaje se lleva todo, la tarjeta se cierra y devuelve null. Sin saldo todavía, se crea
// uno. Si no sale nada, la nota entera pasa a Saldos. El total se queda en la nota original para no
// contarlo dos veces.
const envioParcial = db.transaction((id, enviar) => {
  const nota = obtener(id);
  if (nota.saldo || !CHOFER_EDITABLE.includes(nota.estado)) throw httpError(409, 'Sólo se divide una nota en Pendiente o Cargando');
  const hermanas = hermanasDe(nota);
  const { va, queda, avisos } = dividir(nota, enviar, hermanas);
  if (!queda.length && !hermanas.length) throw httpError(400, 'Va la nota completa: no hay saldo. Usa el botón normal para avanzarla');
  if (!va.length) {
    if (hermanas.length) stmts.partes.run({ ...armar(queda, avisos), id });
    cerrarSaldos(hermanas, id);
    stmts.marcarSaldo.run(id);
    stmts.historial.run(id, nota.estado, 'saldo');
    return stmts.porId.get(id);
  }
  stmts.partes.run({ ...armar(va, avisos), id });
  if (!queda.length) {
    cerrarSaldos(hermanas, id);
    return null;
  }
  const [primera, ...resto] = hermanas;
  if (primera) {
    cerrarSaldos(resto, primera.id);
    stmts.partes.run({ ...armar(queda, avisos), id: primera.id });
    return stmts.porId.get(primera.id);
  }
  const { lastInsertRowid } = stmts.insertar.run({
    ...OPCIONALES,
    ...armar(queda, avisos),
    origen: nota.origen,
    folio: folioDeSaldo(nota),
    id_externo: nota.id_externo,
    cliente_id: nota.cliente_id,
    direccion: nota.direccion,
    zona: nota.zona,
    foto: nota.foto,
    telefono: nota.telefono,
    etiqueta: nota.etiqueta,
    creado_en: nota.creado_en,
  });
  stmts.marcarSaldo.run(lastInsertRowid);
  stmts.historial.run(lastInsertRowid, null, 'saldo');
  return stmts.porId.get(lastInsertRowid);
});

const reprogramar = db.transaction((id) => {
  const nota = obtener(id);
  if (!nota.saldo) throw httpError(409, `${nota.folio} no está en Saldos Pendientes`);
  stmts.reprogramar.run(id);
  stmts.historial.run(id, 'saldo', 'pendiente');
  return stmts.porId.get(id);
});

// Cancelar borra la nota con su historial y avisos. integracion_vistos no se toca: así el robot
// no vuelve a traer de Pulpos una nota cancelada.
function eliminar(id) {
  const nota = obtener(id);
  stmts.eliminar.run(id);
  return nota;
}

module.exports = {
  ESTADOS,
  ponerEtiqueta: (id, etiqueta) => { obtener(id); stmts.ponerEtiqueta.run(etiqueta, id); return stmts.porId.get(id); },
  ponerTelefono: (id, telefono) => { obtener(id); stmts.ponerTelefono.run(telefono, id); return stmts.porId.get(id); },
  sinDireccion,
  cerrarJornada,
  renglones: (id) => {
    const nota = obtener(id);
    return renglonesVentana(nota, hermanasDe(nota));
  },
  envioParcial,
  reprogramar,
  historialGeneral: () => stmts.historial_general.all(),
  editar,
  eliminar,
  listarTablero: () => stmts.tablero.all(),
  obtener,
  obtenerSiExiste: (id) => stmts.porId.get(id),
  crear,
  cambiarEstado,
  regresar,
  asignar,
  resumen: () => stmts.resumen.get(),
};
