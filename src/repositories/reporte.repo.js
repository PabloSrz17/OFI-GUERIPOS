// Reporte semanal de los tres agentes. La semana va del lunes 08:00 al cierre del sábado
// (antes del domingo 00:00). Todo se cuenta por fecha local, como se guarda en la base.
const db = require('../db/connection');

const stmts = {
  // Las descartadas son avisos que no eran orden: no cuentan como solicitadas.
  ordenes: db.prepare(`SELECT COUNT(*) AS n FROM ordenes_compra
    WHERE estado <> 'descartada' AND creado_en >= @inicio AND creado_en < @fin`),
  entradas: db.prepare('SELECT COUNT(*) AS n FROM entradas_almacen WHERE creado_en >= @inicio AND creado_en < @fin'),
  // Sólo las hechas en la semana; de ésas, las pagadas antes del cierre. Así no entra un pago
  // de una cotización de otra semana, y el número no cambia si el reporte se saca después.
  cotizaciones: db.prepare(`SELECT COUNT(*) AS creadas,
      COUNT(CASE WHEN estado = 'pagada' AND pagada_en < @fin THEN 1 END) AS pagadas
    FROM cotizaciones WHERE creado_en >= @inicio AND creado_en < @fin`),
  // Cada nota entregada es un viaje; cuenta la última vez que pasó a Entregado y que siga ahí.
  viajes: db.prepare(`SELECT COALESCE(ch.nombre, 'Sin chofer') AS chofer, COALESCE(ca.nombre, 'Sin unidad') AS unidad, COUNT(*) AS viajes
    FROM notas n
    LEFT JOIN choferes ch ON ch.id = n.chofer_id
    LEFT JOIN camiones ca ON ca.id = n.camion_id
    WHERE n.estado = 'entregado'
      AND (SELECT MAX(h.fecha) FROM historial_estados h WHERE h.nota_id = n.id AND h.estado_nuevo = 'entregado') >= @inicio
      AND (SELECT MAX(h.fecha) FROM historial_estados h WHERE h.nota_id = n.id AND h.estado_nuevo = 'entregado') < @fin
    GROUP BY 1, 2 ORDER BY viajes DESC, chofer, unidad`),
};

const dos = (n) => String(n).padStart(2, '0');
const dia = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;

// La semana del día dado ('AAAA-MM-DD'); sin día, la de hoy. El domingo es de la semana que acaba de cerrar.
function semana(fecha) {
  const [a, m, d] = (fecha ?? dia(new Date())).split('-').map(Number);
  const lunes = new Date(a, m - 1, d - ((new Date(a, m - 1, d).getDay() + 6) % 7));
  const domingo = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 6);
  return { inicio: `${dia(lunes)} 08:00:00`, fin: `${dia(domingo)} 00:00:00` };
}

function generar(fecha) {
  const periodo = semana(fecha);
  const viajes = stmts.viajes.all(periodo);
  const { creadas, pagadas } = stmts.cotizaciones.get(periodo);
  return {
    ...periodo,
    octavio: { ordenes: stmts.ordenes.get(periodo).n, entradas: stmts.entradas.get(periodo).n },
    chatito: { creadas, pagadas },
    edgar: { despachados: viajes.reduce((s, v) => s + v.viajes, 0), viajes },
  };
}

module.exports = { semana, generar };
