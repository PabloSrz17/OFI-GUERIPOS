// Robot de Pulpos ("El Chasis"): revisa todas las Ventas cada minuto con un navegador oculto y da
// de alta en el tablero las nuevas con envío a domicilio. No basta con "No Entregadas": en caja
// muchas ventas con envío se marcan entregadas al cobrar y nunca aparecen en esa lista.
// Pulpos no ofrece API ni webhooks; este robot lee la misma pantalla que ve el usuario.
const puppeteer = require('puppeteer');
const { pulpos: config } = require('../../config');
const importador = require('../importador');
const notas = require('../../repositories/notas.repo');
const estado = require('../estado');
const auditoria = require('./auditoria');
const { parseFecha, parseDetalle, aVenta, esEnvio } = require('./parser');

const BASE = 'https://app.pulpos.com';
const ORIGEN = 'pulpos';
const MAX_PAGINAS = 8; // 25 ventas por página, de la más nueva a la más vieja
// Una venta de verdad: mientras carga, la tabla muestra una fila suelta que no es venta.
const CON_VENTAS = `document.querySelector('table tbody tr a[href*="/sales/detail"]')`;

class SesionCerrada extends Error {}

let navegador = null;
let temporizador = null;

// Se guarda la promesa: el ciclo y Sulema pueden pedirlo a la vez y sólo debe abrirse uno.
function abrirNavegador() {
  navegador ??= puppeteer.launch({ headless: true, userDataDir: config.perfil }).catch((err) => {
    navegador = null;
    throw err;
  });
  return navegador;
}

async function cerrarNavegador() {
  const n = navegador;
  navegador = null;
  const abierto = await n?.catch(() => null);
  await abierto?.close().catch(() => {});
}

// Pulpos es una app de una sola página: redirige al login después de cargar. Por eso se
// espera a que aparezca el contenido esperado (listo) o el formulario de contraseña.
async function ir(page, url, listo) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(
    `document.querySelector('input[type="password"]') || (${listo})`,
    { timeout: 45_000, polling: 500 },
  );
  if (await page.$('input[type="password"]')) throw new SesionCerrada();
}

// Junta las páginas de ventas hasta llegar a una anterior a "desde".
async function leerLista(page, desde) {
  const filas = [];
  for (let p = 1; p <= MAX_PAGINAS; p++) {
    const pagina = await leerPagina(page, p);
    filas.push(...pagina);
    const ultima = parseFecha(pagina.at(-1)?.Fecha ?? '');
    if (pagina.length < 25 || (ultima && ultima < desde)) break;
  }
  return filas;
}

// Devuelve las filas de una página como objetos { Venta, Fecha, Cliente, Total, …, href }.
async function leerPagina(page, numero) {
  await ir(page, `${BASE}/sales?p=${numero}&d=desc&f=madeAt`, CON_VENTAS);
  return filasDeLaTabla(page);
}

function filasDeLaTabla(page) {
  return page.$$eval('table', ([tabla]) => {
    if (!tabla) return [];
    const encabezados = [...tabla.querySelectorAll('thead th')].map((th) => th.innerText.trim());
    return [...tabla.querySelectorAll('tbody tr')].map((tr) => {
      const fila = {};
      tr.querySelectorAll('td').forEach((td, i) => {
        if (encabezados[i]) fila[encabezados[i]] = td.innerText.trim();
      });
      fila.href = tr.querySelector('a[href*="/sales/detail"]')?.getAttribute('href') ?? null;
      return fila;
    });
  });
}

async function leerDetalle(page, href) {
  // Las ventas de mostrador no traen "Forma de Entrega": todas sí traen "Subtotal".
  await ir(page, new URL(href, BASE).href, `document.querySelector('main')?.innerText.includes('Subtotal')`);
  await new Promise((listo) => setTimeout(listo, 800)); // que termine de pintar el resto de la venta
  return parseDetalle(await page.$eval('main', (el) => el.innerText));
}

// Una venta que no se puede leer no detiene a las demás: se avisa y se reintenta en la siguiente vuelta.
async function revisarFilas(filas, desde, leer) {
  let nuevas = 0;
  const problemas = [];
  const devueltas = [];
  const revisar = [];
  for (const fila of filas) {
    const folio = fila.Venta;
    if (!folio) continue;
    // Devuelta o cancelada en Pulpos: ya no se reparte. Si ya estaba en el tablero, se avisa.
    if (/cancel|reembols/i.test(fila.Pago ?? '') || /devuelt/i.test(fila.Productos ?? '')) {
      if (importador.activa(ORIGEN, folio)) devueltas.push(folio);
      continue;
    }
    if (!fila.href || importador.yaVisto(ORIGEN, folio)) continue;
    try {
      const fecha = parseFecha(fila.Fecha);
      if (!fecha) throw new Error(`fecha desconocida "${fila.Fecha}"`);
      if (fecha < desde) continue;

      const detalle = await leer(fila.href);
      if (config.soloEnvios && !esEnvio(detalle)) {
        importador.omitir(ORIGEN, folio, detalle.formaEntrega || 'sin forma de entrega');
        auditoria.omitida(folio, detalle);
        continue;
      }
      const idExterno = new URL(fila.href, BASE).searchParams.get('id');
      const venta = aVenta(fila, detalle, idExterno);
      auditoria.importada(folio, detalle, venta);
      importador.registrar(venta);
      if (venta.advertencias.length) revisar.push(folio);
      nuevas++;
    } catch (err) {
      console.error(`[pulpos] ${folio}:`, err.message);
      auditoria.error(folio, err.message);
      problemas.push(folio);
    }
  }
  return { nuevas, problemas, devueltas, revisar };
}

async function revisar() {
  const desde = importador.importarDesde(ORIGEN);
  const page = await (await abrirNavegador()).newPage();
  try {
    const filas = await leerLista(page, desde);
    const { nuevas, problemas, devueltas, revisar: porRevisar } = await revisarFilas(filas, desde, (href) => leerDetalle(page, href));
    const hora = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    if (problemas.length) estado.reportar(ORIGEN, false, `No pude leer ${problemas.join(', ')} · reintento · ${hora}`);
    else if (devueltas.length) estado.reportar(ORIGEN, false, `Devueltas en Pulpos, revisa en el tablero: ${devueltas.join(', ')} · ${hora}`);
    else if (porRevisar.length) estado.reportar(ORIGEN, false, `Revisa contra Pulpos: ${porRevisar.join(', ')} · ${hora}`);
    else estado.reportar(ORIGEN, true, nuevas ? `${nuevas} venta(s) nueva(s) · ${hora}` : `Al día · ${hora}`);
    if (nuevas) console.log(`[pulpos] ${nuevas} venta(s) nueva(s) importada(s)`);
  } finally {
    await page.close().catch(() => {});
  }
}

// ---- Para Sulema: mirar Pulpos y traer al tablero una nota que no entró sola ----

const ESPERA_BUSQUEDA_MS = 15_000;
const esDevuelta = (fila) => /cancel|reembols/i.test(fila.Pago ?? '') || /devuelt/i.test(fila.Productos ?? '');

async function conPagina(trabajo) {
  if (!config.activo) throw new Error('el robot de Pulpos está desactivado');
  const page = await (await abrirNavegador()).newPage();
  try {
    return await trabajo(page);
  } catch (err) {
    if (err instanceof SesionCerrada) throw new Error('la sesión de Pulpos está cerrada');
    throw err;
  } finally {
    await page.close().catch(() => {});
  }
}

// Ventas de los últimos días que no están en el tablero, y notas que esperan dirección.
async function buscarFueraEn(page, dias) {
  const desde = new Date();
  desde.setHours(0, 0, 0, 0);
  desde.setDate(desde.getDate() - Math.min(Math.max(Number(dias) || 0, 0), 7));
  const filas = await leerLista(page, desde);
  const fuera = filas
    .filter((f) => f.Venta && !esDevuelta(f) && !importador.situacion(ORIGEN, f.Venta).estado && (parseFecha(f.Fecha) ?? 0) >= desde)
    .map((f) => ({ folio: f.Venta, fecha: f.Fecha, cliente: f.Cliente || '(sin cliente)', total: f.Total, pago: f.Pago }));
  return {
    fuera_del_tablero: fuera.slice(0, 60),
    cuantas: fuera.length,
    en_tablero_sin_direccion: notas.listarTablero()
      .filter((n) => notas.sinDireccion(n) && !n.es_almacen && n.estado !== 'entregado')
      .map((n) => ({ folio: n.folio, cliente: n.cliente, columna: n.estado })),
  };
}

const MOTIVOS = {
  omitida: 'en Pulpos no traía envío a domicilio ni dirección, así que parecía venta de mostrador',
  importada: 'ya había entrado y la cancelaron en el tablero',
  ninguno: 'el robot no la había revisado; puede ser anterior a la fecha desde la que importa',
};

function datosFaltantes(nota) {
  return [
    notas.sinDireccion(nota) && 'dirección o colonia',
    !nota.cliente_telefono && 'teléfono del cliente (sin él no recibirá WhatsApp)',
    /^SIN NOMBRE/i.test(nota.cliente) && 'nombre del cliente',
  ].filter(Boolean);
}

// Usa la búsqueda de Pulpos: encuentra el folio sin importar qué tan vieja sea la venta.
async function buscarVenta(page, folio) {
  await page.goto(`${BASE}/sales?q=${encodeURIComponent(folio)}&p=1&d=desc&f=madeAt`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(`document.querySelector('input[type="password"]') || (${CON_VENTAS})`, { timeout: ESPERA_BUSQUEDA_MS, polling: 500 })
    .catch(() => {}); // sin resultados nunca aparece una venta
  if (await page.$('input[type="password"]')) throw new SesionCerrada();
  return (await filasDeLaTabla(page)).find((f) => f.Venta?.toUpperCase() === folio) ?? null;
}

async function rescatarEn(page, folioPedido) {
  const folio = String(folioPedido ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,20}$/.test(folio)) return { ok: false, motivo: 'Ese folio no es válido' };
  const antes = importador.situacion(ORIGEN, folio);
  if (antes.estado) return { ok: false, ya_estaba: true, folio, columna: antes.estado, motivo: 'Esa nota ya está en el tablero' };

  const fila = await buscarVenta(page, folio);
  if (!fila?.href) return { ok: false, folio, motivo: 'Pulpos no tiene ninguna venta con ese folio' };

  const detalle = await leerDetalle(page, fila.href);
  const venta = aVenta(fila, detalle, new URL(fila.href, BASE).searchParams.get('id'));
  auditoria.importada(folio, detalle, venta);
  const nota = importador.registrar(venta);
  console.log(`[pulpos] ${folio}: rescatada por Sulema`);
  const clave = antes.resultado?.startsWith('omitida') ? 'omitida' : antes.resultado === 'importada' ? 'importada' : 'ninguno';
  return {
    ok: true,
    folio,
    cliente: nota.cliente,
    productos: detalle.productos.map((p) => `${p.cantidad} ${p.unidad ?? ''} ${p.nombre}`.replace(/\s+/g, ' ')),
    columna: 'pendiente',
    por_que_no_habia_entrado: MOTIVOS[clave],
    faltan: datosFaltantes(nota),
    avisos: venta.advertencias,
  };
}

const buscarFuera = (dias) => conPagina((page) => buscarFueraEn(page, dias));
const rescatar = (folio) => conPagina((page) => rescatarEn(page, folio));

async function ciclo() {
  try {
    await revisar();
  } catch (err) {
    if (err instanceof SesionCerrada) {
      estado.reportar(ORIGEN, false, 'Sesión de Pulpos cerrada: ejecuta "npm run pulpos:login"');
    } else {
      estado.reportar(ORIGEN, false, `No pude leer Pulpos: ${err.message}`);
      console.error('[pulpos]', err);
      await cerrarNavegador(); // siguiente ciclo con navegador limpio
    }
  }
  temporizador = setTimeout(ciclo, config.intervaloMs);
}

function iniciar() {
  if (!config.activo) {
    estado.reportar(ORIGEN, null, 'Desactivado (PULPOS_ACTIVO=true en .env)');
    return;
  }
  estado.reportar(ORIGEN, true, 'Iniciando…');
  ciclo();
}

async function detener() {
  clearTimeout(temporizador);
  await cerrarNavegador();
}

module.exports = { iniciar, detener, revisarFilas, buscarFuera, rescatar, buscarFueraEn, rescatarEn };
