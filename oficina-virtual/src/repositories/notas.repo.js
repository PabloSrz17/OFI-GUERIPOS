const db = require('../db/connection');
const { httpError } = require('../lib/errors');
const { renglonesVentana, dividir, armar, saldoAjustado } = require('../lib/parcial');

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

// El domingo no se labora: el "Reparto de mañana" de un sábado es el lunes.
const MANANA = `date('now', 'localtime', CASE strftime('%w', 'now', 'localtime') WHEN '6' THEN '+2 day' ELSE '+1 day' END)`;

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
         (SELECT s.fecha_hoja FROM sheets_registros s WHERE s.nota_id = n.id) AS sheets_fecha,
         (SELECT COUNT(*) FROM evidencias e WHERE e.nota_id = n.id) AS evidencias,
         (SELECT COUNT(*) FROM notas p WHERE n.folio_principal IS NOT NULL AND p.origen = n.origen
            AND p.folio_principal = n.folio_principal AND p.saldo = 0 AND p.estado IN ('en_ruta', 'entregado')) AS salidas
  FROM notas n
  JOIN clientes c ON c.id = n.cliente_id
  LEFT JOIN choferes ch ON ch.id = n.chofer_id
  LEFT JOIN camiones ca ON ca.id = n.camion_id`;

const stmts = {
  ponerPrincipal: db.prepare('UPDATE notas SET folio_principal = ? WHERE id = ?'),
  saldoDeFamilia: db.prepare('SELECT id FROM notas WHERE origen = ? AND folio_principal = ? AND saldo = 1 AND id <> ? ORDER BY id LIMIT 1'),
  // Viajes de un pedido que ya salieron, con la hora en que salieron (o se entregaron en Almacén).
  salidasDe: db.prepare(`
    SELECT n.id, n.folio, n.estado, n.cantidad, n.unidad, n.material, n.detalle,
           ch.nombre AS chofer, COALESCE(ca.nombre, ch.unidad) AS camion,
           (SELECT MIN(h.fecha) FROM historial_estados h WHERE h.nota_id = n.id AND h.estado_nuevo IN ('en_ruta', 'entregado')) AS fecha
    FROM notas n
    LEFT JOIN choferes ch ON ch.id = n.chofer_id
    LEFT JOIN camiones ca ON ca.id = n.camion_id
    WHERE n.origen = ? AND n.folio_principal = ? AND n.saldo = 0 AND n.estado IN ('en_ruta', 'entregado')
    ORDER BY fecha, n.id`),
  // El tablero muestra todo lo activo y sólo lo entregado hoy que no se ha archivado con el cierre.
  // Las notas programadas para otro día esperan en el corcho de Edgar hasta su fecha.
  tablero: db.prepare(`${SELECT_NOTA}
    WHERE (n.estado <> 'entregado' OR (date(n.actualizado_en) = date('now', 'localtime') AND n.archivada_en IS NULL))
      AND (n.programada_para IS NULL OR n.programada_para <= date('now', 'localtime'))
    ORDER BY n.creado_en, n.id`),
  programadas: db.prepare(`${SELECT_NOTA}
    WHERE n.estado <> 'entregado' AND n.programada_para > date('now', 'localtime')
    ORDER BY n.programada_para, n.creado_en, n.id`),
  paraManana: db.prepare(`
    SELECT folio FROM notas
    WHERE estado <> 'entregado' AND programada_para = ${MANANA} ORDER BY id`),
  viaje: db.prepare('UPDATE notas SET viaje = ? WHERE id = ?'),
  mananaAHoy: db.prepare(`UPDATE notas SET programada_para = NULL, con_fecha = 0 WHERE estado <> 'entregado' AND programada_para = ${MANANA}`),
  programar: db.prepare(`UPDATE notas SET programada_para = ?, con_fecha = ?, actualizado_en = datetime('now', 'localtime') WHERE id = ?`),
  // Las que se programaron con fecha del cliente y llegan mañana: Edgar avisa.
  conFechaManana: db.prepare(`SELECT n.id, n.folio, c.nombre AS cliente FROM notas n JOIN clientes c ON c.id = n.cliente_id
    WHERE n.estado <> 'entregado' AND n.con_fecha = 1 AND n.programada_para = ${MANANA} ORDER BY n.id`),
  // Historial general: todo lo entregado que ya no está en el tablero.
  historial_general: db.prepare(`${SELECT_NOTA}
    WHERE n.estado = 'entregado' AND (n.archivada_en IS NOT NULL OR date(n.actualizado_en) < date('now', 'localtime'))
    ORDER BY n.actualizado_en DESC, n.id DESC LIMIT 200`),
  // Buscar en el historial por folio o cliente (sin importar mayúsculas).
  historial_buscar: db.prepare(`${SELECT_NOTA}
    WHERE n.estado = 'entregado' AND (n.archivada_en IS NOT NULL OR date(n.actualizado_en) < date('now', 'localtime'))
      AND (n.folio LIKE @q OR c.nombre LIKE @q OR n.folio_principal LIKE @q)
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
  ponerPostit: db.prepare('UPDATE notas SET postit = ? WHERE id = ?'),
  ponerFolio: db.prepare('UPDATE notas SET folio = ? WHERE id = ?'),
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
  devolver: db.prepare(`
    UPDATE notas SET estado = 'pendiente', archivada_en = NULL, chofer_id = NULL, camion_id = NULL, viaje = NULL,
      programada_para = ?, con_fecha = 0, actualizado_en = datetime('now', 'localtime') WHERE id = ?`),
  historial: db.prepare(`
    INSERT INTO historial_estados (nota_id, estado_anterior, estado_nuevo) VALUES (?, ?, ?)`),
  // Entrega registrada después: todo con la fecha y hora en que de verdad se entregó.
  historialEn: db.prepare(`
    INSERT INTO historial_estados (nota_id, estado_anterior, estado_nuevo, fecha) VALUES (?, ?, ?, ?)`),
  entregarEn: db.prepare(`
    UPDATE notas SET estado = 'entregado', chofer_id = @chofer_id, camion_id = @camion_id, viaje = @viaje,
      programada_para = NULL, con_fecha = 0, actualizado_en = @cuando, archivada_en = @cuando WHERE id = @id`),
  chofer: db.prepare('SELECT id, almacen FROM choferes WHERE id = ?'),
  camion: db.prepare('SELECT id FROM camiones WHERE id = ?'),
  resumen: db.prepare(`
    SELECT
      COALESCE(SUM(estado = 'pendiente' AND saldo = 0), 0) AS pendiente,
      COALESCE(SUM(saldo = 1), 0) AS saldos,
      COALESCE(SUM(estado = 'cargando'), 0)  AS cargando,
      COALESCE(SUM(estado = 'en_ruta'), 0)   AS en_ruta,
      COALESCE(SUM(estado = 'entregado' AND archivada_en IS NULL AND date(actualizado_en) = date('now', 'localtime')), 0) AS entregado_hoy,
      COALESCE(SUM(estado = 'pendiente' AND saldo = 0 AND (chofer_id IS NULL OR (camion_id IS NULL
        AND chofer_id NOT IN (SELECT id FROM choferes WHERE almacen = 1)))), 0) AS sin_chofer
    FROM notas
    WHERE programada_para IS NULL OR programada_para <= date('now', 'localtime')`),
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

// 📅 Entrega pasada: la nota se entregó otro día (ej. ayer) y no se marcó. Queda entregada con esa
// fecha, chofer, camión y viaje, así cae en el historial, la hoja y el reporte de ese día y no en los de hoy.
// La hora es fija por viaje (1er viaje 09:00, 2do 10:00…) para que el reporte cuente los viajes por separado.
const entregarAntes = db.transaction((id, { fecha, chofer_id, camion_id, viaje }) => {
  const nota = obtener(id);
  if (nota.saldo) throw httpError(409, `${nota.folio}: es un saldo; primero re-prográmalo en Pendientes`);
  if (nota.estado === 'entregado') throw httpError(409, `${nota.folio} ya está entregada`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) throw httpError(400, 'Elige la fecha en que se entregó');
  const { hoy, limite } = db.prepare("SELECT date('now', 'localtime') AS hoy, date('now', 'localtime', '-60 day') AS limite").get();
  if (fecha >= hoy) throw httpError(400, 'La fecha debe ser de ayer para atrás (lo de hoy se marca normal)');
  if (fecha < limite) throw httpError(400, 'Sólo se pueden registrar entregas de los últimos 60 días');
  const chofer = stmts.chofer.get(Number(chofer_id));
  if (!chofer) throw httpError(400, 'Elige el chofer que la entregó');
  const camion = chofer.almacen ? null : stmts.camion.get(Number(camion_id));
  if (!chofer.almacen && !camion) throw httpError(400, 'Elige el camión que la llevó');
  const v = Number(viaje) || 1;
  if (!Number.isInteger(v) || v < 1 || v > VIAJES) throw httpError(400, `El viaje va del 1 al ${VIAJES}`);
  const cuando = `${fecha} ${String(8 + v).padStart(2, '0')}:00:00`;
  stmts.entregarEn.run({ id, chofer_id: chofer.id, camion_id: camion?.id ?? null, viaje: v, cuando });
  stmts.historialEn.run(id, nota.estado, 'entregado', cuando);
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

// Un viaje de un pedido dividido cambió (o se borró, despues = null): su tarjeta de saldo se ajusta.
// Si el viaje bajó y ya no había saldo, se abre uno nuevo; si el saldo llega a 0, se cierra.
function sincronizarSaldo(antes, despues, { crear = true } = {}) {
  if (!antes.folio_principal || antes.saldo) return null;
  const fila = stmts.saldoDeFamilia.get(antes.origen, antes.folio_principal, antes.id);
  const saldo = fila ? stmts.porId.get(fila.id) : null;
  if (!saldo && !crear) return null;
  const ajuste = saldoAjustado(saldo, antes, despues);
  if (!ajuste) return null;
  if (saldo) {
    if (!ajuste.renglones.length) {
      stmts.eliminar.run(saldo.id);
      return null;
    }
    stmts.partes.run({ ...armar(ajuste.renglones, ajuste.avisos), id: saldo.id });
    return stmts.porId.get(saldo.id);
  }
  if (!ajuste.renglones.length) return null;
  const nuevo = crearSaldo(despues ?? antes, ajuste.renglones, ajuste.avisos);
  stmts.ponerPrincipal.run(antes.folio_principal, nuevo.id);
  return stmts.porId.get(nuevo.id);
}

// Corrige cualquier dato de la nota, en cualquier estado. La hoja de reparto no se actualiza:
// a una entregada ya se le escribió su renglón.
const editar = db.transaction((id, datos) => {
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
  const editada = stmts.porId.get(id);
  sincronizarSaldo(nota, editada);
  return editada;
});

// Cierre de Jornada: lo entregado pasa al historial. Pendiente, Saldos, Cargando y En Ruta no se tocan.
const cerrarJornada = db.transaction(() => {
  const { pendiente, saldos, cargando, en_ruta: enRuta, entregado_hoy: archivadas } = stmts.resumen.get();
  stmts.archivar.run(); // también las de días pasados, que ya no se veían en el tablero
  // El Reparto de mañana pasa al Reparto del día tal cual (camión y viaje no se tocan).
  const deManana = stmts.mananaAHoy.run().changes;
  return { archivadas, deManana, conservadas: { pendiente, saldos, cargando, enRuta } };
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
function dividirNota(id, enviar, desdeSaldo = false) {
  const nota = obtener(id);
  if (nota.saldo || !CHOFER_EDITABLE.includes(nota.estado)) throw httpError(409, 'Sólo se divide una nota en Pendiente o Cargando');
  const hermanas = hermanasDe(nota);
  const { va, queda, avisos } = dividir(nota, enviar, hermanas);
  // Desde la tarjeta de saldo, si sale todo lo que quedaba, sólo se re-programa.
  if (!queda.length && !hermanas.length && !desdeSaldo) throw httpError(400, 'Va la nota completa: no hay saldo. Usa el botón normal para avanzarla');
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
  return crearSaldo(nota, queda, avisos);
}

function crearSaldo(nota, queda, avisos) {
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
}

// Opciones de la ventana: folio nuevo y/o "Salida" para la tarjeta que se va en este viaje.
// Con folio nuevo, el saldo recién creado se queda con el folio original (la nota original menos lo enviado).
const envioParcial = db.transaction((id, enviar, { folio, salida } = {}) => {
  const antes = obtener(id);
  const nuevoFolio = String(folio ?? '').trim();
  if (nuevoFolio.length > 40) throw httpError(400, 'El folio es muy largo');
  const cambiaFolio = nuevoFolio && nuevoFolio !== antes.folio;
  if (cambiaFolio && stmts.folioOcupado.get(antes.origen, nuevoFolio)) throw httpError(409, `Ya hay una nota con el folio ${nuevoFolio}`);
  const sinSaldoAntes = !hermanasDe(antes).length;
  // Salida desde la tarjeta de Saldos: lo que sale vuelve a Pendiente y lo demás sigue en Saldos.
  if (antes.saldo) {
    stmts.reprogramar.run(id);
    stmts.historial.run(id, 'saldo', 'pendiente');
  }
  const principal = antes.folio_principal || folioBase(antes.folio);
  let saldo = dividirNota(id, enviar, Boolean(antes.saldo));
  stmts.ponerPrincipal.run(principal, id);
  if (saldo) stmts.ponerPrincipal.run(principal, saldo.id);
  // De una nota de otro día, lo que queda sigue esperando en Por Confirmar con su misma fecha.
  if (saldo && antes.programada_para && !saldo.programada_para) stmts.programar.run(antes.programada_para, antes.con_fecha ? 1 : 0, saldo.id);
  if (obtener(id).saldo) return saldo; // no salió nada: la nota entera pasó a Saldos
  if (cambiaFolio) {
    // El saldo recién creado pudo tomar justo el folio nuevo (-S1): se aparta un momento y luego se cruzan.
    const saldoNuevo = saldo && sinSaldoAntes;
    if (saldoNuevo) stmts.ponerFolio.run(`__parcial_${saldo.id}`, saldo.id);
    stmts.ponerFolio.run(nuevoFolio, id);
    if (saldoNuevo) {
      stmts.ponerFolio.run(antes.folio, saldo.id);
      saldo = stmts.porId.get(saldo.id);
    }
  }
  if (salida) stmts.ponerEtiqueta.run('SALIDA', id);
  return saldo && stmts.porId.get(saldo.id);
});

const reprogramar = db.transaction((id) => {
  const nota = obtener(id);
  if (!nota.saldo) throw httpError(409, `${nota.folio} no está en Saldos Pendientes`);
  stmts.reprogramar.run(id);
  stmts.historial.run(id, 'saldo', 'pendiente');
  return stmts.porId.get(id);
});

// Corcho de Edgar: camión y número de viaje (1 a 7) de una vez. Sin camión no hay viaje.
const VIAJES = 7;
const ponerViaje = db.transaction((id, camionId, viaje) => {
  if (camionId && !(Number.isInteger(viaje) && viaje >= 1 && viaje <= VIAJES)) throw httpError(400, `El viaje debe ser del 1 al ${VIAJES}`);
  const nota = asignar(id, 'camion', camionId || null);
  stmts.viaje.run(camionId && nota.camion_id ? viaje : null, id);
  return stmts.porId.get(id);
});

// Fecha "AAAA-MM-DD" posterior a hoy, o null para regresarla al tablero de hoy.
// "Él avisa": sin día fijo hasta que el cliente confirme. Se guarda como una fecha que nunca llega,
// así el tablero y el aviso de mañana la dejan fuera sin reglas aparte.
const EL_AVISA = '9999-12-31';

// Una fecha que cae en domingo pasa al lunes: ese día no hay reparto.
function sinDomingo(fecha) {
  if (fecha === EL_AVISA) return fecha;
  const d = new Date(`${fecha}T12:00:00Z`);
  if (d.getUTCDay() !== 0) return fecha;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// conFecha: la eligió el cliente (botón "Con fecha"); Edgar avisa un día antes. Mañana o Él avisa no.
function programar(id, fecha, conFecha = false) {
  const nota = obtener(id);
  if (fecha === 'avisa') fecha = EL_AVISA;
  if (fecha != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) throw httpError(400, 'Fecha inválida');
    if (fecha <= db.prepare("SELECT date('now', 'localtime') AS hoy").get().hoy) throw httpError(400, 'La fecha debe ser de mañana en adelante');
    fecha = sinDomingo(fecha);
    if (nota.estado !== 'pendiente') throw httpError(409, `${nota.folio} ya está ${nota.estado === 'cargando' ? 'cargando' : 'en camino'}: sólo se programa una nota pendiente`);
  }
  stmts.programar.run(fecha ?? null, fecha && fecha !== EL_AVISA && conFecha ? 1 : 0, id);
  return stmts.porId.get(id);
}

// "No se entregó" desde el Historial: la nota entregada (o archivada) vuelve a Pendiente sin chofer,
// camión ni viaje, para hoy (fecha null) o para el día elegido (mañana en adelante). No avisa al cliente.
const devolver = db.transaction((id, fecha) => {
  const nota = obtener(id);
  if (nota.estado !== 'entregado') throw httpError(409, `${nota.folio} no está entregada`);
  if (fecha != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) throw httpError(400, 'Fecha inválida');
    if (fecha <= db.prepare("SELECT date('now', 'localtime') AS hoy").get().hoy) throw httpError(400, 'La fecha debe ser de mañana en adelante');
  }
  stmts.devolver.run(fecha ?? null, id);
  stmts.historial.run(id, 'entregado', 'pendiente');
  return { nota: stmts.porId.get(id), anterior: nota.estado };
});

// Cancelar borra la nota con su historial y avisos. integracion_vistos no se toca: así el robot
// no vuelve a traer de Pulpos una nota cancelada.
function eliminar(id) {
  const nota = obtener(id);
  stmts.eliminar.run(id);
  return nota;
}

// Borrar a mano un viaje de un pedido dividido: lo que llevaba regresa a su tarjeta de saldo, si la hay.
// (La cancelación desde SICAR usa eliminar: ahí se cancela el pedido entero.)
const eliminarViaje = db.transaction((id) => {
  const nota = obtener(id);
  stmts.eliminar.run(id);
  sincronizarSaldo(nota, null, { crear: false });
  return nota;
});

module.exports = {
  ESTADOS,
  devolver,
  ponerEtiqueta: (id, etiqueta) => { obtener(id); stmts.ponerEtiqueta.run(etiqueta, id); return stmts.porId.get(id); },
  ponerPostit: (id, texto) => { obtener(id); stmts.ponerPostit.run(texto || null, id); return stmts.porId.get(id); },
  ponerTelefono: (id, telefono) => { obtener(id); stmts.ponerTelefono.run(telefono, id); return stmts.porId.get(id); },
  sinDireccion,
  cerrarJornada,
  renglones: (id) => {
    const nota = obtener(id);
    return renglonesVentana(nota, hermanasDe(nota));
  },
  envioParcial,
  reprogramar,
  // Historial de salidas del pedido al que pertenece la nota (vacío si nunca se dividió).
  salidas: (id) => {
    const nota = obtener(id);
    return nota.folio_principal ? stmts.salidasDe.all(nota.origen, nota.folio_principal) : [];
  },
  historialGeneral: (buscar = '') => {
    const q = String(buscar).trim().replace(/[%_]/g, '');
    return q ? stmts.historial_buscar.all({ q: `%${q}%` }) : stmts.historial_general.all();
  },
  editar,
  eliminar,
  eliminarViaje,
  listarTablero: () => stmts.tablero.all(),
  listarProgramadas: () => stmts.programadas.all(),
  conFechaManana: () => stmts.conFechaManana.all(),
  foliosParaManana: () => stmts.paraManana.all().map((n) => n.folio),
  programar,
  EL_AVISA,
  ponerViaje,
  obtener,
  obtenerSiExiste: (id) => stmts.porId.get(id),
  crear,
  cambiarEstado,
  entregarAntes,
  regresar,
  asignar,
  resumen: () => stmts.resumen.get(),
};
