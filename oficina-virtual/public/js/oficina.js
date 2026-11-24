import { api } from './api.js';
import { montarEscena, estadoAgente, actualizarCamiones, salirCamion, actualizarPantalla } from './escena3d.js';

const AGENTES = {
  chasis: { nombre: 'Sulema', rol: 'Ventas · SICAR y Pulpos' },
  rutas: { nombre: 'Edgar', rol: 'Logística · patio de fletes y camiones' },
  inspector: { nombre: 'Chatito Waspat', rol: 'Cotizaciones y atención' },
  octavio: { nombre: 'Max', rol: 'Órdenes de compra y almacén · Concordia' },
};
// disponible: sin pendientes · procesando: trabajando o contestándote · espera: necesita a un humano
const ESTADOS = { disponible: 'Disponible', procesando: 'Procesando', espera: 'En espera' };
const ESTADO_CAMION = { patio: 'En patio', cargando: 'Cargando', en_ruta: 'En ruta' };

const NOMBRES_CONECTOR = { pulpos: 'PS', pos: 'PV', sicar: 'SC', whatsapp: 'WhatsApp', sheets: 'Sheets', respaldos: 'Respaldo', sync: 'Enlace' };
const CONECTORES_DE_VENTAS = ['pulpos', 'pos', 'sicar']; // los vigila Sulema; WhatsApp lo vigila Edgar

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const actuales = {};          // último [estado, mensaje] de cada agente
const pensando = new Set();   // agentes contestando una pregunta (se muestran "Procesando")

// Etiqueta flotante de cada agente (botón que abre su panel). Se guarda la referencia porque
// la escena 3D sólo la mete al documento al dibujar, y una pestaña en segundo plano no dibuja.
const botones = {};
const objetos = {}; // etiquetas de las pizarras

const OBJETOS = { notas: '🚚 Reparto del Día', dia: '📝 Pendientes del Día', asistencias: '🗓 Asistencias', ordenes: '🧾 Pizarrón de Max', chatito: '💬 Chatito Waspat',
  archivo_sulema: '🗄 Archivero de Sulema', archivo_edgar: '🗄 Archivero de Edgar' };
const COLOR_NOTA = { pendiente: '#f2994a', cargando: '#d4a106', en_ruta: '#2f7fd1' };

export function ponerCuenta(id, n) {
  objetos[id].querySelector('.objeto3d__cuenta').textContent = n || '';
}

// Maqueta 3D; al dar clic en la etiqueta o en el modelo se abre su panel o su ventana.
export function montarOficina(contenedor) {
  for (const [id, a] of Object.entries(AGENTES)) {
    const div = document.createElement('div');
    div.innerHTML = `
      <button type="button" class="agente" data-agente="${id}" data-estado="disponible" aria-label="Abrir a ${a.nombre}">
        <span class="agente__alarma" hidden></span>
        <span class="agente__burbuja" aria-live="polite">…</span>
        <span class="etiqueta"><span class="punto"></span><b>${a.nombre}</b></span>
      </button>`;
    botones[id] = div.firstElementChild;
  }
  for (const [id, texto] of Object.entries(OBJETOS)) {
    const div = document.createElement('div');
    div.innerHTML = `
      <button type="button" class="objeto3d" data-objeto="${id === 'notas' ? 'corcho' : id}" aria-label="Abrir ${texto.slice(3)}">
        <span class="objeto3d__globo" hidden></span>
        <span class="objeto3d__nombre">${texto} <span class="objeto3d__cuenta"></span></span>
      </button>`;
    objetos[id] = div.firstElementChild;
  }
  montarEscena(contenedor, botones, objetos, abrirPanel, (id) => abrirVentana(id === 'notas' ? 'corcho' : id)); // la pantalla de notas abre el Reparto del día
  document.body.addEventListener('click', (e) => {
    const agente = e.target.closest('[data-agente]');
    if (agente && contenedor.contains(agente)) abrirPanel(agente.dataset.agente);
    const objeto = e.target.closest('[data-objeto]');
    if (objeto) abrirVentana(objeto.dataset.objeto);
  });
  document.querySelectorAll('.ventana__cerrar').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || document.querySelector('dialog:modal')) return;
    document.querySelectorAll('.ventana[open], .panel[open]').forEach((d) => d.close());
  });
  document.querySelector('#alerta-lista .alerta__cerrar').addEventListener('click', () => {
    listaDescartada = new Date().toDateString();
    pintarLista();
  });
}

function abrirVentana(id) {
  if (id === 'chatito') {
    abrirPanel('inspector'); // su pantalla abre su panel: no tiene ventana propia
    return;
  }
  if (panel.open) panel.close();
  document.querySelectorAll('.ventana[open]').forEach((d) => d.close());
  // Corcho, Notas pendientes y Otro día son pestañas de una sola ventana de reparto.
  const pestana = { corcho: 'corcho', notas: 'notas', futuras: 'futuras', manana: 'manana' }[id];
  const ventana = document.querySelector(`#ventana-${pestana ? 'notas' : id}`);
  ventana.show();
  if (pestana) ventana.dispatchEvent(new CustomEvent('pestana', { detail: pestana }));
}

// Notas nuevas que Sulema no te ha enseñado (se guarda en este navegador).
const CLAVE_VISTAS = 'chasis-notas-vistas';
let notasVistas = null;
try { notasVistas = Number(localStorage.getItem(CLAVE_VISTAS)) || null; } catch { /* sin almacenamiento */ }
let ultimoResumen = null;
let ultimasNotas = [];

function marcarNotasVistas() {
  notasVistas = Math.max(0, ...ultimasNotas.map((n) => n.id));
  try { localStorage.setItem(CLAVE_VISTAS, notasVistas); } catch { /* sin almacenamiento */ }
}

// No todo es "sin conexión": el robot también avisa sesión cerrada, devoluciones y ventas por revisar.
function avisoDeFalla([id, e]) {
  const nombre = NOMBRES_CONECTOR[id] ?? id;
  const m = e.mensaje ?? '';
  if (/sesi[oó]n.*cerrada/i.test(m)) return `¡${nombre}: sesión cerrada, hay que volver a entrar!`;
  if (/^Devueltas/i.test(m)) return `¡Venta devuelta en ${nombre}! ${m.replace(/^.*?:\s*/, '').replace(/\s*·.*$/, '')}`;
  if (/^Eliminadas/i.test(m)) return `¡Venta eliminada en ${nombre}! ${m.replace(/^.*?:\s*/, '').replace(/\s*·.*$/, '')}`;
  if (/^Revisa contra/i.test(m)) return `¡Revisa contra ${nombre}: ${m.replace(/^.*?:\s*/, '').replace(/\s*·.*$/, '')}!`;
  return `¡${nombre} sin conexión!`;
}

// Traduce los indicadores del servidor en [estado, mensaje, alarma] para cada agente.
// alarma: número o "!" encendido sobre su cabeza; null si no tiene nada que decir.
function estadosAgentes(r) {
  const falla = Object.entries(r.integraciones ?? {})
    .find(([id, e]) => CONECTORES_DE_VENTAS.includes(id) && e.ok === false);
  const whatsappCaido = r.integraciones?.whatsapp?.ok === false;
  const nuevas = ultimasNotas.filter((n) => n.id > notasVistas).length;
  return {
    chasis: falla
      ? ['espera', avisoDeFalla(falla), '!']
      : nuevas
        ? ['espera', `¡${plural(nuevas, 'nota nueva', 'notas nuevas')}!`, nuevas]
        : r.pendiente
          ? ['procesando', `${plural(r.pendiente, 'nota', 'notas')} por despachar`, null]
          : ['disponible', 'Esperando ventas…', null],
    rutas: whatsappCaido
      ? ['espera', '¡WhatsApp sin conexión!', '!']
      : r.fechas_manana?.length
      ? ['espera', `📅 Mañana toca entregar: ${r.fechas_manana.map((n) => `${n.folio} · ${n.cliente}`).join(', ')}`, r.fechas_manana.length]
      : r.sin_chofer
      ? ['espera', `¡${plural(r.sin_chofer, 'nota', 'notas')} sin chofer o camión!`, r.sin_chofer]
      : r.cargando || r.en_ruta
        ? ['procesando', [
          r.cargando && `${r.cargando} cargando`,
          r.en_ruta && `${plural(r.en_ruta, 'viaje', 'viajes')} en ruta`,
        ].filter(Boolean).join(' · '), null]
        : ['disponible', 'Patio despejado', null],
    inspector: r.solicitudes_pendientes
      ? ['espera', `¡${plural(r.solicitudes_pendientes, 'cotización', 'cotizaciones')} por autorizar!`, r.solicitudes_pendientes]
      : [
        r.cotizaciones_hoy ? 'procesando' : 'disponible',
        `${plural(r.cotizaciones_hoy ?? 0, 'cotización', 'cotizaciones')} hoy · ${plural(r.clientes, 'cliente', 'clientes')}`,
        null,
      ],
    octavio: r.ordenes_por_aprobar
      ? ['espera', `¡${plural(r.ordenes_por_aprobar, 'orden', 'órdenes')} por aprobar!`, r.ordenes_por_aprobar]
      : r.ordenes_por_surtir
        ? ['procesando', `${plural(r.ordenes_por_surtir, 'orden', 'órdenes')} por surtir`, null]
        : ['disponible', 'Esperando órdenes…', null],
  };
}

function pintarAgente(id) {
  const [estadoBase, mensaje, alarma] = actuales[id] ?? ['disponible', '…', null];
  const estado = pensando.has(id) ? 'procesando' : estadoBase;
  const el = botones[id];
  el.dataset.estado = estado;
  estadoAgente(id, estado);
  el.querySelector('.agente__alarma').hidden = alarma === null;
  el.querySelector('.agente__alarma').textContent = alarma ?? '';
  el.querySelector('.agente__burbuja').textContent = pensando.has(id) ? 'Pensando…' : mensaje;
  if (panel.dataset.agente === id) {
    panel.querySelector('.panel__estado').textContent = ESTADOS[estado];
    panel.querySelector('.panel__estado').dataset.estado = estado;
    panel.querySelector('.panel__ahora').textContent = mensaje;
  }
}

export function actualizarOficina(resumen, notas = ultimasNotas) {
  ultimoResumen = resumen;
  ultimasNotas = notas;
  if (notasVistas === null) marcarNotasVistas(); // primera vez en este navegador: no alarma por lo viejo
  Object.assign(actuales, estadosAgentes(resumen));
  Object.keys(AGENTES).forEach(pintarAgente);
  ponerCuenta('notas', resumen.pendiente + resumen.cargando + resumen.en_ruta);
  ponerCuenta('ordenes', resumen.ordenes_por_surtir);
  ponerCuenta('chatito', resumen.solicitudes_pendientes);
  actualizarPantalla('notas', notas
    .filter((n) => COLOR_NOTA[n.estado])
    .map((n) => ({ texto: `${n.folio} · ${n.cliente}`, color: COLOR_NOTA[n.estado] })));
  actualizarPantalla('chatito', [
    { texto: `${resumen.solicitudes_pendientes ?? 0} por autorizar`, color: resumen.solicitudes_pendientes ? '#d92d20' : '#2f9e5b' },
    { texto: plural(resumen.cotizaciones_hoy ?? 0, 'cotización hoy', 'cotizaciones hoy') },
    { texto: plural(resumen.clientes ?? 0, 'cliente', 'clientes') },
    resumen.integraciones?.whatsapp?.ok === false
      ? { texto: 'WhatsApp sin conexión', color: '#d92d20' }
      : { texto: 'WhatsApp conectado', color: '#2f9e5b' },
  ]);
  pintarLista();
}

// Globo sobre la Pizarra de Asistencias y aviso emergente: desde las 10:00 hasta pasar lista.
let listaDescartada = null;
function pintarLista() {
  const pendiente = Boolean(ultimoResumen?.asistencia_pendiente);
  const globo = objetos.asistencias.querySelector('.objeto3d__globo');
  globo.hidden = !pendiente;
  globo.textContent = '⏰ ¡Pasa lista!';
  document.querySelector('#alerta-lista').hidden = !pendiente || listaDescartada === new Date().toDateString();
}

// Camiones del patio con su estado (según sus notas Cargando / En ruta).
export function actualizarFlota(camiones = []) {
  actualizarCamiones(camiones, ESTADO_CAMION);
}

// La nota salió a ruta: su camión arranca y sale del patio.
export function animarSalida(nota) {
  if (nota.camion) salirCamion(nota.camion);
}

// ---- Panel lateral del agente: rol, estado y chat ----
const panel = document.querySelector('#panel-agente');
const historial = { chasis: [], rutas: [], inspector: [], octavio: [] }; // se guarda en el servidor; aquí, la copia en pantalla

// El chat queda abajo del panel: se baja a él, salvo que haya cotizaciones esperando autorización arriba.
function verChat() {
  if (conversacion.classList.contains('cerrada')) return;
  const porAutorizar = panel.dataset.agente === 'inspector' && !panel.querySelector('#solicitudes').hidden;
  if (!porAutorizar && historial[panel.dataset.agente].length) panel.scrollTop = 1e9;
}

async function cargarChat(id) {
  try {
    const mensajes = await api.get(`/api/agentes/${id}/chat`);
    if (pensando.has(id)) return; // hay una respuesta en camino: la lista local va al día
    historial[id] = mensajes;
    if (panel.dataset.agente === id && panel.open) {
      pintarChat();
      verChat();
    }
  } catch { /* se queda lo que ya está en pantalla */ }
}

function pintarChat() {
  const id = panel.dataset.agente;
  panel.querySelector('.panel__chat').innerHTML = historial[id].length
    ? historial[id].map((m) => `<p class="chat chat--${m.de}"><b>${m.de === 'tu' ? 'Tú' : AGENTES[id].nombre}:</b>${esc(m.texto)}</p>`).join('')
    : `<p class="chat chat--vacio">Pregúntale algo de su área. Para que aprenda: "recuerda que…".</p>`;
  panel.querySelector('.panel__chat').scrollTop = 1e9;
}

function abrirPanel(id) {
  panel.dataset.agente = id;
  panel.querySelector('.panel__sprite').dataset.agente = id;
  panel.querySelector('.panel__sprite').textContent = AGENTES[id].nombre[0];
  panel.querySelector('.panel__nombre').textContent = AGENTES[id].nombre;
  panel.querySelector('.panel__rol').textContent = AGENTES[id].rol;
  panel.querySelector('textarea').placeholder = `Escríbele a ${AGENTES[id].nombre}…`;
  panel.querySelector('.panel__enviar').textContent = `Enviar a ${AGENTES[id].nombre}`;
  panel.querySelectorAll('[data-funcion]').forEach((f) => { f.hidden = f.dataset.funcion !== id; });
  panel.querySelector('.panel__whatsapp').hidden = id !== 'inspector';
  if (id === 'chasis' && ultimoResumen) {
    marcarNotasVistas();
    actualizarOficina(ultimoResumen);
  }
  pintarAgente(id);
  pintarChat();
  document.querySelectorAll('.ventana[open]').forEach((d) => d.close());
  if (!panel.open) panel.show(); // no modal: el resto de la oficina sigue usable
  panel.scrollTop = 0;
  mostrarConversacion(false); // siempre empieza retraída
  panel.querySelectorAll('details.plegable').forEach((d) => { d.open = false; });
  cargarChat(id);
}

panel.querySelector('.panel__cerrar').addEventListener('click', () => panel.close());
const conversacion = panel.querySelector('.panel__conversacion');
const botonChat = panel.querySelector('.panel__irchat');
function mostrarConversacion(abierta) {
  conversacion.classList.toggle('cerrada', !abierta);
  botonChat.setAttribute('aria-expanded', String(abierta));
  botonChat.textContent = abierta ? '💬 Ocultar conversación ↑' : '💬 Ver conversación ↓';
  if (!abierta) return;
  panel.querySelector('.panel__chat').scrollTop = 1e9;
  panel.querySelector('textarea').focus({ preventScroll: true });
  setTimeout(() => conversacion.scrollIntoView({ behavior: 'smooth', block: 'end' }), 300); // al terminar de abrirse
}
botonChat.addEventListener('click', () => mostrarConversacion(conversacion.classList.contains('cerrada')));
panel.querySelector('.panel__form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = panel.dataset.agente;
  const caja = panel.querySelector('textarea');
  const pregunta = caja.value.trim();
  if (!pregunta || pensando.has(id)) return;
  caja.value = '';
  historial[id].push({ de: 'tu', texto: pregunta });
  pensando.add(id);
  pintarAgente(id);
  pintarChat();
  panel.scrollTop = 1e9;
  try {
    const { respuesta } = await api.post(`/api/agentes/${id}/preguntar`, { pregunta });
    historial[id].push({ de: 'agente', texto: respuesta });
  } catch (err) {
    historial[id].push({ de: 'agente', texto: `⚠️ ${err.message}` });
  } finally {
    pensando.delete(id);
    pintarAgente(id);
    if (panel.dataset.agente === id) {
      pintarChat();
      panel.scrollTop = 1e9;
    }
  }
});
panel.querySelector('textarea').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.form.requestSubmit(); }
});


// Insignias de la barra superior: una por conector, con el detalle en el tooltip.
export function actualizarConectores(contenedor, integraciones = {}) {
  contenedor.replaceChildren(...Object.entries(NOMBRES_CONECTOR).map(([id, nombre]) => {
    const e = integraciones[id];
    const el = document.createElement(id === 'whatsapp' ? 'a' : 'span');
    if (id === 'whatsapp') el.href = '/whatsapp.html';
    el.className = `badge ${e?.ok === true ? 'ok' : e?.ok === false ? 'error' : ''}`;
    el.textContent = `${nombre} ${e?.ok === true ? '✓' : e?.ok === false ? '✗' : '–'}`;
    el.title = e?.mensaje ?? 'Sin datos';
    return el;
  }));
}
