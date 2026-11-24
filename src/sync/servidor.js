// Enlace entre la Oficina Principal y la de Mostrador (ver motor.js).
// - /api/sync/*: lo que el otro servidor pide (cambios y, la primera vez, una copia completa). Protegido con
//   SYNC_TOKEN, igual en los dos .env; va antes del PIN porque lo pide un servidor, no una persona.
// - Cada SYNC_INTERVALO_SEG, este servidor le pide al otro sus cambios. Los dos hacen lo mismo: así viaja en las
//   dos direcciones, y si uno está apagado el otro sigue trabajando y se ponen al día al volver.
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const config = require('../config');
const db = require('../db/connection');
const bus = require('../events/bus');
const estado = require('../integraciones/estado');
const notas = require('../repositories/notas.repo');
const { crearMotor } = require('./motor');
const programa = require('./programa');

const ORIGEN = 'sync';
const ORDEN = ['pendiente', 'cargando', 'en_ruta', 'entregado'];
const motor = crearMotor(db, { rol: config.rol });
motor.instalar();

let ultimoOk = 0;
let ultimoError = null;
let ultimoResultado = null;
let temporizador = null;
let enCurso = null;

const nombrePar = config.rol === 'secondary' ? 'el servidor Principal' : 'el servidor de Mostrador';

function tokenValido(req) {
  const dado = Buffer.from(String(req.get('X-Sync-Token') ?? ''));
  const esperado = Buffer.from(config.sync.token);
  return esperado.length > 0 && dado.length === esperado.length && crypto.timingSafeEqual(dado, esperado);
}

const router = express.Router();
router.use((req, res, next) => {
  if (!config.sync.token) return res.status(503).json({ error: 'Sincronización sin configurar (SYNC_TOKEN en .env)' });
  if (!tokenValido(req)) return res.status(401).json({ error: 'Token de sincronización inválido' });
  next();
});
router.get('/hola', (req, res) => res.json({ nodo: motor.nodo(), rol: config.rol }));
router.get('/cambios', (req, res) => res.json(motor.cambiosDesde(Number(req.query.desde) || 0, { par: String(req.query.yo ?? '') || null })));
router.get('/foto', (req, res) => res.json(motor.foto()));

// Impresora de tickets de esta PC: el Punto de Venta del Principal imprime aquí (src/impresora.js).
router.get('/impresoras', async (req, res) => {
  try {
    res.json(await require('../impresora').listar());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.post('/imprimir', express.raw({ type: () => true, limit: '2mb' }), async (req, res) => {
  const impresora = String(req.query.impresora ?? '').trim();
  if (!impresora || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Falta la impresora o el ticket' });
  try {
    await require('../impresora').imprimir(impresora, req.body);
    res.json({ ok: true });
  } catch (e) {
    console.error(`[impresora] ${e.message}`);
    res.status(502).json({ error: e.message });
  }
});

// Programa para el Mostrador (actualización automática, src/sync/programa.js). Sólo lo reparte el Principal.
const RAIZ = path.join(__dirname, '..', '..');
let cache = null;
const manifiesto = () => {
  if (!cache || Date.now() - cache.t > 5000) cache = { t: Date.now(), m: programa.manifiesto(RAIZ) };
  return cache.m;
};
// En el Mostrador sólo dice qué versión tiene y cómo va su actualización (para revisarlo desde el Principal).
router.get('/programa', (req, res) =>
  res.json(config.rol === 'primary' ? manifiesto() : { rol: config.rol, version: manifiesto().version, actualizacion: actualizador?.estado() ?? null }),
);
router.get('/programa/archivo', (req, res) => {
  const ruta = String(req.query.ruta ?? '');
  if (config.rol !== 'primary' || !manifiesto().archivos.some((a) => a.ruta === ruta)) return res.status(404).json({ error: 'No existe' });
  res.sendFile(programa.rutaSegura(RAIZ, ruta), { dotfiles: 'allow' });
});

async function pedir(ruta) {
  const r = await fetch(`${config.sync.peer}/api/sync${ruta}`, {
    headers: { 'X-Sync-Token': config.sync.token },
    signal: AbortSignal.timeout(30_000),
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error ?? `respondió ${r.status}`);
  return datos;
}

/** Avisa a las pantallas y, en el Principal, a Google Sheets y WhatsApp de las notas que cambiaron de estado. */
function avisar(r) {
  if (!r || (!r.aplicados && !r.fundidos?.length && !r.renumerados?.length)) return;
  bus.emit('sync:aplicado');
  for (const e of r.estados ?? []) {
    const nota = notas.obtenerSiExiste(e.id);
    if (!nota) continue;
    const retroceso = e.anterior != null && ORDEN.indexOf(e.nuevo) < ORDEN.indexOf(e.anterior);
    bus.emit('nota:estado', { nota, anterior: e.anterior, retroceso, sincronizado: true });
  }
  if (r.conflictos?.length) console.error(`[sync] ${r.conflictos.length} cambios no se pudieron aplicar (ver /api/sincronizacion)`);
}

async function traer(reintento = false) {
  let par = motor.par();
  if (config.rol === 'secondary' && !par?.inicializado) {
    const r = motor.inicializar(await pedir('/foto'));
    console.log(`[sync] copia inicial del servidor Principal (${r.modo})`);
    avisar({ aplicados: 1, ...r });
    par = motor.par();
  }
  let desde = par?.version ?? 0;
  const cambios = [];
  let r;
  let paginas = 0;
  do {
    r = await pedir(`/cambios?desde=${desde}&yo=${encodeURIComponent(motor.nodo())}`);
    if (par && r.nodo !== par.nodo && !reintento) {
      // El otro servidor tiene otra base (se reinstaló o se restauró un respaldo): se empieza de nuevo con él.
      console.log(`[sync] ${nombrePar} cambió de base de datos: se vuelve a sincronizar todo`);
      motor.reiniciarPar(par.nodo);
      return traer(true);
    }
    if (r.ultima < desde) {
      desde = 0; // su bitácora empezó de nuevo
      cambios.length = 0;
      continue;
    }
    cambios.push(...r.cambios);
    desde = r.hasta;
  } while (r.mas && ++paginas < 400);
  const resultado = motor.aplicar(cambios, { nodo: r.nodo, version: desde });
  avisar(resultado);
  return resultado;
}

/** Una vuelta de sincronización (si ya hay una en curso, espera esa). */
function sincronizarAhora() {
  if (!config.sync.peer || !config.sync.token) return Promise.resolve(null);
  enCurso ??= traer()
    .then((r) => {
      ultimoOk = Date.now();
      ultimoError = null;
      ultimoResultado = r;
      const n = r.aplicados + r.fundidos.length + r.renumerados.length;
      estado.reportar(ORIGEN, true, `Conectado con ${nombrePar}${n ? ` (${n} cambios recibidos)` : ''}`);
      return r;
    })
    .catch((err) => {
      ultimoError = err.name === 'TimeoutError' || err.cause?.code ? `No contesta (${err.cause?.code ?? 'tiempo agotado'})` : err.message;
      estado.reportar(ORIGEN, false, `Sin conexión con ${nombrePar}: ${ultimoError}. Se trabaja aquí y se junta al volver.`);
      return null;
    })
    .finally(() => {
      enCurso = null;
    });
  return enCurso;
}

/** ¿El otro servidor contestó hace poco? (el Mostrador sólo importa de SICAR si el Principal no está). */
const parEnLinea = () => Date.now() - ultimoOk < config.sync.intervaloMs * 3 + 10_000;

let actualizador = null;
let temporizadorPrograma = null;

/** Mostrador: revisa cada pocos minutos si el Principal tiene programa nuevo y se actualiza solo. */
function iniciarActualizacion(reiniciar) {
  if (config.rol !== 'secondary' || !config.sync.actualizar || !reiniciar) return;
  actualizador = programa.crearActualizador({
    raiz: RAIZ,
    datos: path.join(RAIZ, 'data'),
    pedir,
    bajar: async (ruta) => {
      const r = await fetch(`${config.sync.peer}/api/sync/programa/archivo?ruta=${encodeURIComponent(ruta)}`, {
        headers: { 'X-Sync-Token': config.sync.token },
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) throw new Error(`${ruta}: respondió ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    },
    reiniciar,
  });
  actualizador.confirmarAlArrancar();
  const vuelta = async () => {
    const antes = actualizador.estado();
    const ahora = await actualizador.revisar();
    if (ahora !== antes) console.log(`[actualizacion] ${ahora}`);
    temporizadorPrograma = setTimeout(vuelta, config.sync.actualizarMs);
    temporizadorPrograma.unref?.();
  };
  temporizadorPrograma = setTimeout(vuelta, 60_000);
  temporizadorPrograma.unref?.();
}

function iniciar({ reiniciar } = {}) {
  iniciarActualizacion(reiniciar);
  if (!config.sync.peer || !config.sync.token) {
    estado.reportar(ORIGEN, null, 'Sin otro servidor (PEER_SERVER_URL y SYNC_TOKEN en .env)');
    return;
  }
  console.log(`[sync] servidor ${config.rol === 'secondary' ? 'de Mostrador' : 'Principal'}; se sincroniza con ${config.sync.peer}`);
  const vuelta = async () => {
    await sincronizarAhora();
    temporizador = setTimeout(vuelta, config.sync.intervaloMs);
    temporizador.unref?.();
  };
  vuelta();
}

function detener() {
  clearTimeout(temporizador);
  clearTimeout(temporizadorPrograma);
  actualizador?.detener();
}

/** Estado para la pantalla de la Oficina (detrás del PIN). */
const resumen = () => ({
  ...motor.estado(),
  peer: config.sync.peer || null,
  configurado: !!(config.sync.peer && config.sync.token),
  enLinea: parEnLinea(),
  ultimoOk: ultimoOk ? new Date(ultimoOk).toISOString() : null,
  ultimoError,
  programa: actualizador?.estado() ?? null,
  ultimoResultado: ultimoResultado && { ...ultimoResultado, tablas: [...ultimoResultado.tablas] },
});

module.exports = { router, iniciar, detener, sincronizarAhora, parEnLinea, resumen, motor };
