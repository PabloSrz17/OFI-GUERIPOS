// Punto de entrada común para los conectores (Pulpos, SICAR): deduplica y da de alta notas.
const db = require('../db/connection');
const notas = require('../repositories/notas.repo');
const clientes = require('../repositories/clientes.repo');
const bus = require('../events/bus');

const stmts = {
  visto: db.prepare('SELECT 1 FROM integracion_vistos WHERE origen = ? AND folio = ?'),
  enTablero: db.prepare('SELECT 1 FROM notas WHERE origen = ? AND folio = ?'),
  activa: db.prepare(`SELECT 1 FROM notas WHERE origen = ? AND (folio = ? OR folio LIKE ?) AND estado <> 'entregado'`),
  activas: db.prepare(`SELECT id, folio, etiqueta FROM notas WHERE origen = ? AND estado <> 'entregado'`),
  resultado: db.prepare('SELECT resultado FROM integracion_vistos WHERE origen = ? AND folio = ?'),
  estadoNota: db.prepare('SELECT estado FROM notas WHERE origen = ? AND folio = ?'),
  marcar: db.prepare('INSERT OR REPLACE INTO integracion_vistos (origen, folio, resultado) VALUES (?, ?, ?)'),
  leerAjuste: db.prepare('SELECT valor FROM ajustes WHERE clave = ?'),
  guardarAjuste: db.prepare('INSERT INTO ajustes (clave, valor) VALUES (?, ?)'),
};

// También cuenta como vista si ya se capturó a mano (ej. notas de SICAR antes del conector).
const yaVisto = (origen, folio) =>
  Boolean(stmts.visto.get(origen, folio) || stmts.enTablero.get(origen, folio));

function omitir(origen, folio, motivo) {
  stmts.marcar.run(origen, folio, `omitida: ${motivo}`);
}

const insertar = db.transaction(({ cliente, nota }) => {
  const creada = notas.crear({ ...nota, cliente_id: clientes.obtenerOCrear(cliente) });
  stmts.marcar.run(nota.origen, nota.folio, 'importada');
  return creada;
});

// venta = { cliente: { nombre }, nota: { origen, folio, material, cantidad, unidad, direccion, … } }
function registrar(venta) {
  const nota = insertar(venta);
  bus.emit('nota:creada', nota);
  return nota;
}

// Sólo se importan ventas posteriores al primer arranque del conector; así no entran
// cientos de pendientes históricos. Se guarda en la BD para que sobreviva reinicios.
function importarDesde(origen) {
  const clave = `${origen}_importar_desde`;
  let valor = stmts.leerAjuste.get(clave)?.valor;
  if (!valor) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    valor = hoy.toISOString();
    stmts.guardarAjuste.run(clave, valor);
  }
  return new Date(valor);
}

// También cuenta su saldo: si devuelven la venta, ese material tampoco se debe repartir.
const activa = (origen, folio) => Boolean(stmts.activa.get(origen, folio, `${folio}-S%`));
// Notas aún no entregadas de un origen: [{ id, folio }] (los saldos traen "-S1" en el folio).
const activas = (origen) => stmts.activas.all(origen);
// En qué quedó una venta: { resultado, estado } (estado: columna donde está su nota, si tiene).
const situacion = (origen, folio) => ({
  resultado: stmts.resultado.get(origen, folio)?.resultado ?? null,
  estado: stmts.estadoNota.get(origen, folio)?.estado ?? null,
});

module.exports = { yaVisto, activa, activas, situacion, omitir, registrar, importarDesde };
