// Conector de SICAR: lee (sólo lectura) la base MySQL de SICAR en la PC "MOSTRADOR"
// y da de alta en el tablero las ventas nuevas.
const mysql = require('mysql2/promise');
const { sicar: config } = require('../../config');
const importador = require('../importador');
const estado = require('../estado');
const consultas = require('./consultas');

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
  return pool;
}

async function revisar() {
  const ventas = await consultas.ventasDesde(conexion(), importador.importarDesde(ORIGEN));
  const hora = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  if (ventas === null) {
    estado.reportar(ORIGEN, null, `Conectado a SICAR · falta mapear tablas de ventas (${hora})`);
    return;
  }
  let nuevas = 0;
  for (const venta of ventas) {
    if (importador.yaVisto(ORIGEN, venta.nota.folio)) continue;
    importador.registrar(venta);
    nuevas++;
  }
  estado.reportar(ORIGEN, true, nuevas ? `${nuevas} venta(s) nueva(s) · ${hora}` : `Al día · ${hora}`);
  if (nuevas) console.log(`[sicar] ${nuevas} venta(s) nueva(s) importada(s)`);
}

async function ciclo() {
  try {
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
