// Punto de Venta (POS) dentro de la Oficina: mismo servidor y mismo puerto, en http://localhost:3000/pos/.
// El POS viene armado en pos/ (lo genera el proyecto del POS con "npm run build:oficina") y tiene su propio
// usuario y contraseña. Sus datos y respaldos quedan en data/pos/ (o en POS_DATOS del .env).
// Se monta antes del JSON, el PIN y la CSP de la Oficina: el POS lee sus propios envíos (hasta 20 MB) y manda sus
// propios encabezados. La regla de "sólo red local" de la Oficina sí le aplica.
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const CARPETA = path.join(__dirname, '..', 'pos');
const MODULO = path.join(CARPETA, 'pos-modulo.cjs');

function montar(app) {
  // Servidor de Mostrador: el POS es uno solo (el del Principal), para que no haya dos bases de ventas con los
  // mismos folios. El botón "Punto de Venta" lleva allá.
  if (config.rol === 'secondary' && config.sync.peer) {
    app.use('/pos', (req, res) => res.redirect(302, `${config.sync.peer}${req.originalUrl}`));
    console.log(`[pos] Punto de Venta: se usa el del servidor Principal (${config.sync.peer}/pos/)`);
    return true;
  }
  if (!fs.existsSync(MODULO)) {
    console.log('[pos] Punto de Venta no instalado (falta pos/pos-modulo.cjs)');
    return false;
  }
  // El módulo lee su configuración al cargarse.
  process.env.POS_HOME = config.pos.datos;
  process.env.POS_PORT = String(config.port);
  process.env.POS_PUBLIC_PATH = '/pos/';
  process.env.POS_HOME_URL = '/'; // botón "Oficina Virtual" del POS
  // Impresora de tickets en la PC de Mostrador: el POS le manda los tickets por el enlace.
  if (config.pos.imprimirEnMostrador && config.sync.peer && config.sync.token) {
    process.env.POS_PRINT_RELAY = `${config.sync.peer}/api/sync`;
    process.env.POS_PRINT_RELAY_TOKEN = config.sync.token;
    console.log(`[pos] Tickets: se imprimen en la PC de Mostrador (${config.sync.peer})`);
  }
  const modulo = require(MODULO);
  const listo = modulo.createPosHandler();
  listo.then(() => (posListo = modulo.oficina ?? null), () => {});
  listo.then(
    () => console.log(`[pos] Punto de Venta listo en http://localhost:${config.port}/pos/ (datos: ${config.pos.datos})`),
    (e) => console.error('[pos] No arrancó el Punto de Venta:', e),
  );

  app.use('/pos', async (req, res, next) => {
    // Sin la diagonal final, las rutas relativas de la app apuntarían a la Oficina.
    const [ruta, consulta] = req.originalUrl.split('?');
    if (ruta === '/pos') return res.redirect(301, `/pos/${consulta ? `?${consulta}` : ''}`);
    try {
      await (await listo)(req, res);
    } catch (e) {
      next(e);
    }
  });
  return true;
}

let posListo = null;

/**
 * Lo que la Oficina lee y escribe del Punto de Venta (ventas, retiros de caja): el conector de src/integraciones/pos.
 * null si en esta PC no corre el POS (Mostrador) o todavía no arranca.
 */
const api = () => posListo;

module.exports = { montar, api };
