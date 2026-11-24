// Conector de SICAR: lee (sólo lectura) la base MySQL de SICAR en la PC "MOSTRADOR"
// y da de alta en el tablero las ventas nuevas. Sólo ventas: nada de inventario ni compras.
const mysql = require('mysql2/promise');
const { sicar: config } = require('../../config');
const importador = require('../importador');
const estado = require('../estado');
const consultas = require('./consultas');
const notas = require('../../repositories/notas.repo');
const bus = require('../../events/bus');
const ordenes = require('../octavio/ordenes');

const ORIGEN = 'sicar';
let pool = null;
let temporizador = null;

function conexion() {
  pool ??= mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: 2,
    connectTimeout: 10_000,
    dateStrings: true,
  });
  // Además del candado de consultas.js: la sesión de MySQL no puede escribir nada.
  pool.pool.on('connection', (c) => c.query('SET SESSION TRANSACTION READ ONLY'));
  return pool;
}

async function revisar() {
  const ventas = await consultas.ventasDesde(conexion(), importador.importarDesde(ORIGEN));
  const hora = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  let nuevas = 0;
  for (const venta of ventas) {
    if (importador.yaVisto(ORIGEN, venta.nota.folio)) continue;
    importador.registrar(venta);
    nuevas++;
  }
  const canceladas = await cancelarLasDeSicar();
  const compras = await revisarCompras();
  const partes = [nuevas && `${nuevas} venta(s) nueva(s)`, canceladas.length && `cancelada(s) en SICAR: ${canceladas.join(', ')}`,
    compras && `${compras} compra(s) nueva(s) para Max`].filter(Boolean);
  estado.reportar(ORIGEN, true, `${partes.length ? partes.join(' · ') : 'Al día'} · ${hora}`);
  if (nuevas) console.log(`[sicar] ${nuevas} venta(s) nueva(s) importada(s)`);
}

// Compras de SICAR (se capturan al pedir) -> Órdenes de Compra Almacén de Max. La cancelada en SICAR
// pasa a Canceladas si todavía no llega nada.
async function revisarCompras() {
  const nuevas = ordenes.importarDeSicar(await consultas.comprasDesde(conexion(), importador.importarDesde('sicar_compras')));
  ordenes.cancelarDeSicar(await consultas.comprasCanceladas(conexion(), ordenes.externasAbiertas()));
  if (nuevas) console.log(`[sicar] ${nuevas} compra(s) nueva(s) al pizarrón de Max`);
  return nuevas;
}

// Nota cancelada en SICAR: se cancela también en el tablero (con sus saldos), como el botón ✕.
// Las entregadas no se tocan. Tampoco las de SALIDA, que no son notas de SICAR.
async function cancelarLasDeSicar() {
  const activas = importador.activas(ORIGEN).filter((n) => n.etiqueta !== 'SALIDA');
  const base = (folio) => String(folio).replace(/-S\d+$/, '');
  const canceladas = await consultas.canceladasDe(conexion(), activas.map((n) => base(n.folio)));
  for (const n of activas.filter((x) => canceladas.includes(base(x.folio)))) {
    bus.emit('nota:eliminada', notas.eliminar(n.id));
    console.log(`[sicar] ${n.folio} cancelada en SICAR: se canceló en la Oficina`);
  }
  return canceladas;
}

// En el servidor de Mostrador, SICAR sólo se importa mientras el Principal no contesta (si no, lo importa él y aquí
// llega por la sincronización). Así la misma venta no se importa dos veces.
const enEspera = () => require('../../config').rol === 'secondary' && require('../../sync/servidor').parEnLinea();

async function ciclo() {
  try {
    if (enEspera()) {
      estado.reportar(ORIGEN, true, 'En espera: el servidor Principal importa las ventas de SICAR');
      temporizador = setTimeout(ciclo, config.intervaloMs);
      return;
    }
    await revisar();
  } catch (err) {
    const mensaje = err.code === 'ER_ACCESS_DENIED_ERROR'
      ? 'SICAR rechazó el usuario o contraseña (revisa .env)'
      : ['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(err.code)
        ? `No alcanzo la PC MOSTRADOR (${config.host}): ¿está encendida?`
        : `Error leyendo SICAR: ${err.message}`;
    estado.reportar(ORIGEN, false, mensaje);
    console.error('[sicar]', err.code ?? '', err.message);
  }
  temporizador = setTimeout(ciclo, config.intervaloMs);
}

function iniciar() {
  if (!config.activo || !config.user) {
    estado.reportar(ORIGEN, null, 'Sin configurar: falta usuario de MySQL de SICAR en .env');
    return;
  }
  ciclo();
}

async function detener() {
  clearTimeout(temporizador);
  await pool?.end().catch(() => {});
}

module.exports = { iniciar, detener };
