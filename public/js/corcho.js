// Corchos de Edgar: (1) programación del día por unidad, (2) notas para otro día.
// Las notas programadas no salen en el tablero ni en el corcho del día hasta su fecha (lo filtra el servidor).
import { api } from './api.js';

const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const NOMBRE_ESTADO = { pendiente: 'Pendiente', cargando: 'Cargando', en_ruta: 'En Ruta' };

// Columnas fijas; lo que no es de estas cuatro (sin camión, Almacén, Torton…) va en la última.
const UNIDADES = [
  { nombre: 'Nissan Blanca', es: /nissan\s*blanca/i },
  { nombre: 'Nissan Roja', es: /nissan\s*roja/i },
  { nombre: 'RAM', es: /^ram\b/i },
  { nombre: 'Ford F450', es: /f\s*-?\s*450/i },
];
const OTRAS = 'Sin unidad u otras';
const EL_AVISA = '9999-12-31'; // "Él avisa": sin día fijo (notas.repo.js)
const VIAJES = ['1er', '2do', '3er', '4to', '5to'];
// Notas con camión pero sin viaje anotado (asignadas desde el tablero) se ven en el 1er viaje.
const viajeDe = (n) => Math.min(Math.max(Number(n.viaje) || 1, 1), VIAJES.length);

const dia = (desplazar = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + desplazar);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fechaLarga = (iso) => new Date(`${iso}T12:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

let ctx = null;          // { catalogos, toast }
let notasDelDia = [];
let programadas = [];
let arrastrada = null;

function columnaDe(nota) {
  return UNIDADES.find((u) => u.es.test(nota.camion ?? ''))?.nombre ?? OTRAS;
}

function tarjeta(n, { manana = false, futura = false } = {}) {
  const mover = !futura && !n.es_almacen && ['pendiente', 'cargando'].includes(n.estado);
  return `
    <article class="corcho__nota${manana ? ' corcho__nota--manana' : ''}" data-id="${n.id}" ${mover ? 'draggable="true"' : ''}>
      ${manana ? '<p class="corcho__alerta">⏰ Esta nota es para mañana</p>' : ''}
      <header><b>${esc(n.folio)}</b>${futura ? (n.camion ? `<span class="corcho__chip">${esc(n.camion)}</span>` : '') : `<span class="corcho__chip corcho__chip--${n.estado}">${NOMBRE_ESTADO[n.estado] ?? esc(n.estado)}</span>`}</header>
      <p class="corcho__cliente">${esc(n.cliente)}</p>
      <p>${esc(n.cantidad)} ${esc(n.unidad)} · ${esc(n.material)}</p>
      <p class="corcho__suave">📍 ${esc(n.zona || n.direccion)}</p>
      ${!futura && n.chofer ? `<p class="corcho__suave">👤 ${esc(n.chofer)}</p>` : ''}
      ${futura ? `
        <div class="corcho__acciones">
          <input type="date" aria-label="${n.programada_para === EL_AVISA ? 'Poner fecha a' : 'Cambiar fecha de'} ${esc(n.folio)}" value="${n.programada_para === EL_AVISA ? '' : n.programada_para}" min="${dia(1)}" data-fecha>
          <button type="button" class="btn btn--secundario" data-hoy>↩ A hoy</button>
        </div>` : n.estado === 'pendiente' ? '<div class="corcho__acciones"><button type="button" class="btn btn--secundario" data-otro-dia>🗓 Otro día</button></div>' : ''}
    </article>`;
}

function pintarDia() {
  const activas = notasDelDia.filter((n) => n.estado !== 'entregado');
  const columnas = [...UNIDADES.map((u) => u.nombre), OTRAS];
  $('#corcho-fecha').textContent = fechaLarga(dia());
  $('#corcho-contenido').innerHTML = columnas.map((nombre) => {
    const suyas = activas.filter((n) => columnaDe(n) === nombre);
    const m3 = suyas.filter((n) => /m³|m3/i.test(n.unidad ?? '') && Number(n.cantidad)).reduce((s, n) => s + Number(n.cantidad), 0);
    return `
      <section class="corcho__columna${nombre === OTRAS ? ' corcho__columna--otras' : ''}">
        <h3>${nombre === OTRAS ? '' : '🚚 '}${esc(nombre)}</h3>
        <p class="corcho__cuenta">${suyas.length} ${suyas.length === 1 ? 'nota' : 'notas'}${m3 ? ` · ${Math.round(m3 * 10) / 10} m³` : ''}</p>
        ${nombre === OTRAS
          ? `<div class="corcho__zona corcho__zona--otras" data-zona data-columna="${esc(nombre)}">${suyas.map((n) => tarjeta(n)).join('') || '<p class="corcho__vacio">Sin notas</p>'}</div>`
          : VIAJES.map((v, i) => {
            const delViaje = suyas.filter((n) => viajeDe(n) === i + 1);
            return `
            <div class="corcho__zona corcho__viaje" data-zona data-columna="${esc(nombre)}" data-viaje="${i + 1}">
              <h4>${v} viaje${delViaje.length ? ` <span>${delViaje.length}</span>` : ''}</h4>
              ${delViaje.map((n) => tarjeta(n)).join('')}
            </div>`;
          }).join('')}
      </section>`;
  }).join('');
}

function pintarFuturas() {
  const manana = dia(1);
  // "Él avisa" va primero: son las que hay que estar siguiendo con el cliente.
  const fechas = [...new Set(programadas.map((n) => n.programada_para))].sort((a, b) => (a === EL_AVISA ? -1 : b === EL_AVISA ? 1 : a.localeCompare(b)));
  $('#futuras-contenido').innerHTML = fechas.map((f) => `
    <section class="corcho__columna${f === manana ? ' corcho__columna--manana' : ''}${f === EL_AVISA ? ' corcho__columna--avisa' : ''}">
      <h3>${f === EL_AVISA ? '📞 Notas sin día programado' : `${f === manana ? '⏰ Mañana · ' : ''}${esc(fechaLarga(f))}`}</h3>
      ${f === EL_AVISA ? '<p class="corcho__cuenta">El cliente avisa. Ponle fecha cuando confirme.</p>' : ''}
      ${programadas.filter((n) => n.programada_para === f).map((n) => tarjeta(n, { manana: f === manana, futura: true })).join('')}
    </section>`).join('') || '<p class="corcho__vacio">No hay notas para otro día. Prográmalas arriba o con «🗓 Otro día» en el corcho por unidad.</p>';
  // Para programar: las pendientes de hoy.
  const select = $('#futuras-nota');
  const elegida = select.value;
  select.innerHTML = '<option value="">Elige la nota…</option>' + notasDelDia
    .filter((n) => n.estado === 'pendiente')
    .map((n) => `<option value="${n.id}">${esc(n.folio)} · ${esc(n.cliente)} · ${esc(n.material)}</option>`).join('');
  select.value = elegida;
  $('#futuras-fecha').min = manana;
}

async function cargarFuturas() {
  try {
    programadas = await api.get('/api/notas/programadas');
    pintarFuturas();
  } catch (err) {
    ctx.toast(`No se cargaron las notas para otro día: ${err.message}`, true);
  }
}

async function programar(id, fecha) {
  try {
    const nota = await api.patch(`/api/notas/${id}/programar`, { fecha });
    ctx.toast(fecha === 'avisa' ? `${nota.folio} quedó sin día: el cliente avisa` : fecha ? `${nota.folio} quedó para el ${fechaLarga(fecha)}` : `${nota.folio} regresó a hoy`);
  } catch (err) {
    ctx.toast(err.message, true);
  }
  await cargarFuturas(); // el tablero se repinta solo por el aviso del servidor
}

// Soltar en un viaje de una unidad = cambiarle camión y número de viaje (mismas reglas que el tablero).
async function cambiarUnidad(id, columna, viaje) {
  const nota = notasDelDia.find((n) => n.id === id);
  if (!nota) return;
  const u = UNIDADES.find((x) => x.nombre === columna);
  if (columnaDe(nota) === columna && (!u || viajeDe(nota) === viaje)) return;
  const camion = u ? ctx.catalogos.camiones.find((c) => u.es.test(c.nombre)) : null;
  if (u && !camion) return ctx.toast(`No encontré la ${columna} en la lista de camiones`, true);
  try {
    await api.patch(`/api/notas/${id}/viaje`, { camion_id: camion?.id ?? null, viaje });
    ctx.toast(`${nota.folio} → ${camion ? `${camion.nombre} · ${VIAJES[viaje - 1]} viaje` : 'sin unidad'}`);
  } catch (err) {
    ctx.toast(err.message, true);
  }
}

export function montarCorcho({ catalogos, toast }) {
  ctx = { catalogos, toast };
  const ventanaDia = $('#ventana-corcho');
  const ventanaFuturas = $('#ventana-futuras');
  ventanaDia.addEventListener('toggle', (e) => { if (e.newState === 'open') pintarDia(); });
  ventanaFuturas.addEventListener('toggle', (e) => { if (e.newState === 'open') cargarFuturas(); });

  const contenido = $('#corcho-contenido');
  contenido.addEventListener('dragstart', (e) => {
    arrastrada = Number(e.target.closest('[data-id]')?.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  const limpiar = (menos) => contenido.querySelectorAll('.corcho__zona--encima').forEach((z) => z !== menos && z.classList.remove('corcho__zona--encima'));
  contenido.addEventListener('dragover', (e) => {
    const zona = e.target.closest('[data-zona]');
    if (!arrastrada || !zona) return;
    e.preventDefault();
    limpiar(zona);
    zona.classList.add('corcho__zona--encima');
  });
  contenido.addEventListener('drop', (e) => {
    const zona = e.target.closest('[data-zona]');
    if (!arrastrada || !zona) return;
    e.preventDefault();
    cambiarUnidad(arrastrada, zona.dataset.columna, Number(zona.dataset.viaje) || null);
  });
  contenido.addEventListener('dragend', () => {
    arrastrada = null;
    limpiar();
  });
  // «Otro día»: abre el corcho de notas futuras con esa nota ya elegida.
  contenido.addEventListener('click', (e) => {
    if (!e.target.closest('[data-otro-dia]')) return;
    const id = e.target.closest('[data-id]').dataset.id;
    ventanaDia.close();
    ventanaFuturas.show();
    pintarFuturas();
    $('#futuras-nota').value = id;
    $('#futuras-fecha').focus();
  });

  $('#futuras-nueva').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = $('#futuras-nota').value;
    const fecha = $('#futuras-fecha').value;
    if (!id || !fecha) return toast('Elige la nota y la fecha', true);
    $('#futuras-nueva').reset();
    programar(id, fecha);
  });
  const futuras = $('#futuras-contenido');
  futuras.addEventListener('change', (e) => {
    if (e.target.matches('[data-fecha]') && e.target.value) programar(e.target.closest('[data-id]').dataset.id, e.target.value);
  });
  futuras.addEventListener('click', (e) => {
    if (e.target.closest('[data-hoy]')) programar(e.target.closest('[data-id]').dataset.id, null);
  });
}

// Cada vez que cambia el tablero: repinta lo que esté abierto.
export function recargarCorcho(notas) {
  notasDelDia = notas;
  if (!ctx) return;
  if ($('#ventana-corcho').open && !arrastrada) pintarDia();
  if ($('#ventana-futuras').open && !$('#ventana-futuras').contains(document.activeElement)) cargarFuturas();
}
