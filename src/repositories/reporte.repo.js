// Reporte semanal de los tres agentes. La semana va del lunes 08:00 al cierre del sábado
// (antes del domingo 00:00). Todo se cuenta por fecha local, como se guarda en la base.
const db = require('../db/connection');

const stmts = {
  // Las descartadas son avisos que no eran orden: no cuentan como solicitadas.
  ordenes: db.prepare(`SELECT COUNT(*) AS n FROM ordenes_compra
    WHERE estado <> 'descartada' AND creado_en >= @inicio AND creado_en < @fin`),
  entradas: db.prepare('SELECT COUNT(*) AS n FROM entradas_almacen WHERE creado_en >= @inicio AND creado_en < @fin'),
  // Detalle para el reporte: quién pidió qué, y qué entró de qué proveedor.
  listaOrdenes: db.prepare(`SELECT id, solicitante, sucursal, estado, renglones, creado_en FROM ordenes_compra
    WHERE estado <> 'descartada' AND creado_en >= @inicio AND creado_en < @fin ORDER BY creado_en`),
  listaEntradas: db.prepare(`SELECT id, sucursal, proveedor, folio, nota, renglones, creado_en FROM entradas_almacen
    WHERE creado_en >= @inicio AND creado_en < @fin ORDER BY creado_en`),
  // Sólo las hechas en la semana; de ésas, las pagadas antes del cierre. Así no entra un pago
  // de una cotización de otra semana, y el número no cambia si el reporte se saca después.
  cotizaciones: db.prepare(`SELECT COUNT(*) AS creadas,
      COUNT(CASE WHEN estado = 'pagada' AND pagada_en < @fin THEN 1 END) AS pagadas
    FROM cotizaciones WHERE creado_en >= @inicio AND creado_en < @fin`),
  // Notas entregadas del periodo (la última vez que pasó a Entregado y que siga ahí), con la hora
  // en que salió (última vez En ruta; si no pasó por ahí, la de entrega). viajes() las junta en salidas.
  viajes: db.prepare(`SELECT chofer, unidad, COALESCE(salio, entregada) AS salio FROM (
      SELECT COALESCE(ch.nombre, 'Sin chofer') AS chofer, COALESCE(ca.nombre, 'Sin unidad') AS unidad,
        (SELECT MAX(h.fecha) FROM historial_estados h WHERE h.nota_id = n.id AND h.estado_nuevo = 'en_ruta') AS salio,
        (SELECT MAX(h.fecha) FROM historial_estados h WHERE h.nota_id = n.id AND h.estado_nuevo = 'entregado') AS entregada
      FROM notas n
      LEFT JOIN choferes ch ON ch.id = n.chofer_id
      LEFT JOIN camiones ca ON ca.id = n.camion_id
      WHERE n.estado = 'entregado')
    WHERE entregada >= @inicio AND entregada < @fin
    ORDER BY chofer, unidad, 3`),
  // Archivero de Edgar: cada entrega del día, con la misma regla que los viajes.
  entregas: db.prepare(`SELECT * FROM (
      SELECT n.folio, c.nombre AS cliente, n.material, n.cantidad, n.unidad, n.detalle, n.direccion, n.total,
        COALESCE(ch.nombre, 'Sin chofer') AS chofer, COALESCE(ca.nombre, 'Sin unidad') AS camion,
        (SELECT MAX(h.fecha) FROM historial_estados h WHERE h.nota_id = n.id AND h.estado_nuevo = 'entregado') AS entregada_en,
        (SELECT COUNT(*) FROM evidencias e WHERE e.nota_id = n.id) AS evidencias
      FROM notas n
      JOIN clientes c ON c.id = n.cliente_id
      LEFT JOIN choferes ch ON ch.id = n.chofer_id
      LEFT JOIN camiones ca ON ca.id = n.camion_id
      WHERE n.estado = 'entregado')
    WHERE entregada_en >= @inicio AND entregada_en < @fin ORDER BY entregada_en`),
  combustible: db.prepare('SELECT unidad, importe, concepto, litros, reporto, creado_en FROM combustible WHERE creado_en >= @inicio AND creado_en < @fin ORDER BY creado_en'),
  // Control de Gasolina: cada filtro es opcional; la unidad se busca por parte del nombre.
  bitacora: db.prepare(`SELECT id, unidad, importe, concepto, litros, reporto, mensaje, creado_en FROM combustible
    WHERE (@desde IS NULL OR creado_en >= @desde) AND (@hasta IS NULL OR creado_en < date(@hasta, '+1 day'))
      AND (@unidad IS NULL OR upper(unidad) LIKE '%' || @unidad || '%')
      AND (@min IS NULL OR importe >= @min) AND (@max IS NULL OR importe <= @max)
    ORDER BY creado_en DESC, id DESC LIMIT 500`),
  anotar: db.prepare(`INSERT INTO combustible (unidad, importe, concepto, litros, reporto, mensaje)
    VALUES (@unidad, @importe, @concepto, @litros, 'Oficina (a mano)', '')`),
};

const VENTANA_VIAJE_MIN = 20;

// Mismo chofer y unidad saliendo con 20 minutos o menos entre una nota y la siguiente = un solo viaje.
function viajes(periodo) {
  const cuenta = new Map();
  let anterior = null;
  for (const n of stmts.viajes.all(periodo)) {
    const llave = `${n.chofer}|${n.unidad}`;
    const ms = new Date(n.salio.replace(' ', 'T')).getTime();
    const mismo = anterior?.llave === llave && ms - anterior.ms <= VENTANA_VIAJE_MIN * 60_000;
    if (!mismo) {
      const v = cuenta.get(llave) ?? { chofer: n.chofer, unidad: n.unidad, viajes: 0 };
      v.viajes += 1;
      cuenta.set(llave, v);
    }
    anterior = { llave, ms };
  }
  return [...cuenta.values()].sort((a, b) => b.viajes - a.viajes || a.chofer.localeCompare(b.chofer) || a.unidad.localeCompare(b.unidad));
}

const dos = (n) => String(n).padStart(2, '0');
const dia = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;

// La semana del día dado ('AAAA-MM-DD'); sin día, la de hoy. El domingo es de la semana que acaba de cerrar.
function semana(fecha) {
  const [a, m, d] = (fecha ?? dia(new Date())).split('-').map(Number);
  const lunes = new Date(a, m - 1, d - ((new Date(a, m - 1, d).getDay() + 6) % 7));
  const domingo = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 6);
  return { inicio: `${dia(lunes)} 08:00:00`, fin: `${dia(domingo)} 00:00:00` };
}

// Combustible de un periodo: totales, por unidad y cada carga.
function resumenCombustible(periodo) {
  const cargas = stmts.combustible.all(periodo);
  const porUnidad = new Map();
  for (const c of cargas) {
    const u = porUnidad.get(c.unidad) ?? { unidad: c.unidad, cargas: 0, importe: 0, litros: 0 };
    u.cargas += 1;
    u.importe += c.importe;
    u.litros += c.litros ?? 0;
    porUnidad.set(c.unidad, u);
  }
  const suma = (campo) => cargas.reduce((s, c) => s + (c[campo] ?? 0), 0);
  return {
    importe: suma('importe'),
    litros: suma('litros'),
    sin_litros: cargas.filter((c) => !c.litros).length,
    por_unidad: [...porUnidad.values()].sort((a, b) => b.importe - a.importe),
    cargas,
  };
}

// renglones viene como texto JSON: [{cantidad, unidad, material}].
const conRenglones = (fila) => {
  let renglones = [];
  try { renglones = JSON.parse(fila.renglones || '[]'); } catch { /* renglones dañados: se muestran vacíos */ }
  return { ...fila, renglones };
};

function generar(fecha) {
  const periodo = semana(fecha);
  const salidas = viajes(periodo);
  const { creadas, pagadas } = stmts.cotizaciones.get(periodo);
  return {
    ...periodo,
    octavio: {
      ordenes: stmts.ordenes.get(periodo).n,
      entradas: stmts.entradas.get(periodo).n,
      lista_ordenes: stmts.listaOrdenes.all(periodo).map(conRenglones),
      lista_entradas: stmts.listaEntradas.all(periodo).map(conRenglones),
    },
    chatito: { creadas, pagadas },
    edgar: {
      despachados: salidas.reduce((s, v) => s + v.viajes, 0),
      viajes: salidas,
      entregas: stmts.entregas.all(periodo),
      combustible: resumenCombustible(periodo),
    },
  };
}

// Archivero de Edgar: entregas, viajes por chofer y unidad y combustible de un día ('AAAA-MM-DD').
function delDia(fecha) {
  const d = fecha ?? dia(new Date());
  const [a, m, n] = d.split('-').map(Number);
  const periodo = { inicio: `${d} 00:00:00`, fin: `${dia(new Date(a, m - 1, n + 1))} 00:00:00` };
  const combustible = stmts.combustible.all(periodo);
  const suma = (lista) => lista.reduce((s, c) => s + c.importe, 0);
  return {
    dia: d,
    entregas: stmts.entregas.all(periodo),
    viajes: viajes(periodo),
    combustible,
    total_combustible: suma(combustible),
    diesel: suma(combustible.filter((c) => c.concepto === 'diesel')),
  };
}

function bitacoraCombustible({ desde, hasta, unidad, min, max } = {}) {
  const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? '') ? v : null);
  const numero = (v) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const cargas = stmts.bitacora.all({
    desde: fecha(desde), hasta: fecha(hasta), unidad: String(unidad ?? '').trim().toUpperCase() || null, min: numero(min), max: numero(max),
  });
  const porUnidad = {};
  for (const c of cargas) porUnidad[c.unidad] = (porUnidad[c.unidad] ?? 0) + c.importe;
  return {
    cargas,
    total: cargas.reduce((s, c) => s + c.importe, 0),
    por_unidad: Object.entries(porUnidad).map(([u, importe]) => ({ unidad: u, importe })).sort((a, b) => b.importe - a.importe),
  };
}

// Carga anotada a mano en el Control de Gasolina.
function anotarCombustible(carga) {
  const { lastInsertRowid } = stmts.anotar.run(carga);
  return { id: Number(lastInsertRowid), ...carga };
}

module.exports = { semana, generar, delDia, bitacoraCombustible, anotarCombustible };
