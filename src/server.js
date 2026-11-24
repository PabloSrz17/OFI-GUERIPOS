const os = require('node:os');
const path = require('node:path');
const express = require('express');
const config = require('./config');
const notas = require('./repositories/notas.repo');
const choferes = require('./repositories/choferes.repo');
const camiones = require('./repositories/camiones.repo');
const cotizacionesRepo = require('./repositories/cotizaciones.repo');
const clientes = require('./repositories/clientes.repo');
const { manejadorErrores } = require('./lib/errors');
const seguridad = require('./lib/seguridad');
const pin = require('./lib/pin');
const respaldos = require('./integraciones/respaldos');
const integraciones = require('./integraciones/estado');
const robotPulpos = require('./integraciones/pulpos/robot');
const conectorSicar = require('./integraciones/sicar/conector');
const conectorPos = require('./integraciones/pos/conector');
const whatsapp = require('./integraciones/whatsapp/cliente');
const avisosWhatsapp = require('./integraciones/whatsapp/avisos');
const registroSheets = require('./integraciones/sheets/registro');
const agentes = require('./integraciones/agentes/agentes');
const bus = require('./events/bus');
const solicitudes = require('./integraciones/inspector/solicitudes');
const ordenes = require('./integraciones/octavio/ordenes');
const asistencias = require('./repositories/asistencias.repo');
const sync = require('./sync/servidor');

const app = express();
const PUBLICO = path.join(__dirname, '..', 'public');
app.disable('x-powered-by');
app.use(seguridad.soloRedLocal);
// Punto de Venta en /pos/ (misma app y mismo puerto). Va antes del JSON, el PIN y la CSP: tiene los suyos.
require('./pos').montar(app);
// Enlace con el otro servidor (Principal ↔ Mostrador). Lo pide un servidor con SYNC_TOKEN, no una persona: va antes del PIN.
app.use('/api/sync', sync.router);
app.use(seguridad.encabezados(PUBLICO));
app.use(express.json({ limit: '100kb' }));
app.use('/api/pin', pin.router);
// Apagado ordenado para scripts/detener-oficina.ps1 (Windows no manda Ctrl+C a otro proceso): cerrar
// bien el Chrome de WhatsApp evita que al arrancar se quede trabado en "abriendo chats".
// Sólo desde esta PC y con un encabezado propio, que una página web de otro sitio no puede mandar.
app.post('/api/apagar', (req, res) => {
  if (!seguridad.esEstaPC(req) || req.get('X-Oficina') !== 'apagar') return res.status(403).end();
  res.status(202).end();
  console.log('[oficina] apagado ordenado');
  setImmediate(apagar);
});
app.use(pin.proteger);
app.use(express.static(PUBLICO));
app.use('/vendor/three', express.static(path.join(__dirname, '..', 'node_modules', 'three'))); // escena 3D, sin internet
// Lectura de tickets (OCR) en el navegador, sin internet.
app.use('/vendor/tesseract', express.static(path.join(__dirname, '..', 'node_modules', 'tesseract.js', 'dist')));
app.use('/vendor/tesseract-core', express.static(path.join(__dirname, '..', 'node_modules', 'tesseract.js-core')));
app.use('/vendor/tesseract-data', express.static(path.join(__dirname, '..', 'node_modules', '@tesseract.js-data', 'spa')));

app.get('/api/health', (req, res) => res.json({ ok: true, hora: new Date().toISOString() }));
// Estado del enlace con el otro servidor y "Sincronizar ahora".
app.get('/api/sincronizacion', (req, res) => res.json(sync.resumen()));
app.post('/api/sincronizacion/ahora', async (req, res) => {
  await sync.sincronizarAhora();
  res.json(sync.resumen());
});
// Botón "Punto de Venta" en la PC del servidor: abre o trae al frente la ventana de impresión directa.
// 409 = aquí no aplica (otra PC o apagado): el navegador abre /pos/ normal.
app.post('/api/pos/ventana', async (req, res) => {
  // Esta misma PC, la abran como localhost o con su IP de la red.
  const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  const propias = Object.values(os.networkInterfaces()).flat().map((i) => i?.address);
  if (!config.pos.ventana || !(seguridad.esEstaPC(req) || propias.includes(ip))) return res.status(409).json({ error: 'No disponible' });
  const url = config.rol === 'secondary' && config.sync.peer ? `${config.sync.peer}/pos/` : `http://localhost:${config.port}/pos/`;
  try {
    const r = await require('./ventana-pos').abrirVentana({ url, impresora: config.pos.impresora });
    if (r === 'sin-navegador') return res.status(409).json({ error: 'No encontré Chrome ni Edge' });
    res.json({ ventana: r });
  } catch (e) {
    console.error('[pos] no se pudo abrir la ventana:', e.message);
    res.status(409).json({ error: 'No se pudo abrir la ventana' });
  }
});
app.use('/api/notas', require('./routes/notas.routes'));
app.get('/api/choferes', (req, res) => res.json(choferes.listarActivos()));
app.get('/api/camiones', (req, res) => res.json(camiones.listarActivos()));
app.use('/api/clientes', require('./routes/clientes.routes'));
app.use('/api/cotizaciones', require('./routes/cotizaciones.routes'));
app.use('/api/octavio', require('./routes/octavio.routes'));
app.use('/api/pizarron', require('./routes/pizarron.routes'));
app.use('/api/asistencias', require('./routes/asistencias.routes'));
app.use('/api/reportes', require('./routes/reportes.routes'));
app.use('/api/evidencias', require('./routes/evidencias.routes'));
app.use('/api/whatsapp', require('./routes/whatsapp-ventana.routes'));

// Tiempo real (Server-Sent Events): cada pantalla abierta recibe un aviso al cambiar algo y se refresca.
const EVENTOS = {
  'nota:creada': 'tablero', 'nota:estado': 'tablero', 'nota:asignada': 'tablero', 'nota:editada': 'tablero', 'nota:eliminada': 'tablero', 'jornada:cerrada': 'tablero', 'evidencia:nueva': 'tablero',
  'cotizacion:creada': 'tablero', 'pizarron:cambio': 'pizarron', 'solicitud:nueva': 'inspector', 'asistencia:cambio': 'asistencia', 'orden:cambio': 'octavio',
};
bus.setMaxListeners(100); // un oyente por pantalla abierta
app.get('/api/eventos', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const oyentes = Object.entries(EVENTOS).map(([evento, tipo]) => [evento, () => res.write(`event: ${tipo}\ndata: {}\n\n`)]);
  // Llegaron cambios del otro servidor: se refrescan todas las pantallas.
  oyentes.push(['sync:aplicado', () => new Set(Object.values(EVENTOS)).forEach((tipo) => res.write(`event: ${tipo}\ndata: {}\n\n`))]);
  oyentes.forEach(([evento, fn]) => bus.on(evento, fn));
  const latido = setInterval(() => res.write(': latido\n\n'), 25_000); // evita que se corte por inactividad
  req.on('close', () => {
    clearInterval(latido);
    oyentes.forEach(([evento, fn]) => bus.off(evento, fn));
  });
});

app.get('/api/agentes/:id/chat', (req, res) => res.json(agentes.conversacion(req.params.id)));
app.post('/api/agentes/:id/preguntar', async (req, res) =>
  res.json({ respuesta: await agentes.preguntar(req.params.id, req.body?.pregunta ?? '') }));
// Indicadores que alimentan el estado de los agentes virtuales.
app.get('/api/resumen', (req, res) =>
  res.json({
    ...notas.resumen(),
    programadas_manana: notas.foliosParaManana(),
    fechas_manana: notas.conFechaManana(),
    clientes: clientes.contar(),
    cotizaciones_hoy: cotizacionesRepo.hoy(),
    solicitudes_pendientes: solicitudes.pendientes().length,
    ordenes_por_aprobar: ordenes.porAprobar(),
    ordenes_por_surtir: ordenes.porSurtir(),
    asistencia_pendiente: asistencias.pendienteHoy(),
    camiones: camiones.conEstado(),
    integraciones: integraciones.obtener(),
  }));
// Estado de WhatsApp y, si falta vincular, el QR a escanear (lo usa /whatsapp.html). El QR sólo se
// entrega en esta PC: quien lo escanea queda dueño del WhatsApp del negocio.
app.get('/api/whatsapp', async (req, res) =>
  res.json({ ...integraciones.obtener().whatsapp, estaPC: seguridad.esEstaPC(req), qr: seguridad.esEstaPC(req) ? await whatsapp.qrSvg() : null }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use(manejadorErrores);

app.listen(config.port, config.host, () => {
  const ipsLocales = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${config.port}`);
  console.log(`Oficina Virtual lista en http://localhost:${config.port}`);
  if (config.host === '0.0.0.0') ipsLocales.forEach((url) => console.log(`  Red local: ${url}`));
  console.log(`  Servidor ${config.rol === 'secondary' ? 'de Mostrador (secundario)' : 'Principal'}; Chatito ${config.chatito ? 'activo' : 'apagado'}`);
  robotPulpos.iniciar();
  conectorSicar.iniciar();
  conectorPos.iniciar(); // apagado hasta POS_CONECTOR_ACTIVO=true
  // Chatito: todo lo que lee o escribe en el WhatsApp del negocio. En Mostrador va apagado (ENABLE_CHATITO=false).
  if (config.chatito) {
    avisosWhatsapp.iniciar();
    solicitudes.iniciar(whatsapp);
    require('./integraciones/agentes/grupo').iniciar(whatsapp);
    require('./integraciones/inspector/seguimiento').iniciar();
  }
  require('./integraciones/sulema/paquetes').iniciar();
  require('./integraciones/recordatorio-lista').iniciar();
  require('./integraciones/avisos-celular').iniciar();
  require('./integraciones/aviso-fecha').iniciar();
  whatsapp.iniciar();
  registroSheets.iniciar();
  respaldos.iniciar();
  sync.iniciar({ reiniciar: apagar }); // en Mostrador, también la actualización automática
});

// Cierra los navegadores (robot y WhatsApp) y la conexión a SICAR al detener el servidor (Ctrl+C).
async function apagar() {
  sync.detener();
  conectorPos.detener();
  await Promise.all([robotPulpos.detener(), conectorSicar.detener(), whatsapp.detener()]);
  process.exit(0);
}
for (const senal of ['SIGINT', 'SIGTERM']) process.on(senal, apagar);
