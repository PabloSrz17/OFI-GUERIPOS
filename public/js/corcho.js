// Corchos de Edgar: (1) programación del día por unidad, (2) notas para otro día.
// Las notas programadas no salen en el tablero ni en el corcho del día hasta su fecha (lo filtra el servidor).
import { api } from './api.js';
import { renglones, selector, botonEtiqueta } from './kanban.js';

const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const NOMBRE_ESTADO = { pendiente: 'Pendiente', cargando: 'Cargando', en_ruta: 'En Ruta', entregado: 'Entregado ✓' };

// Columnas fijas; lo que no es de estas cinco (sin camión, Almacén…) va en la última.
export const UNIDADES = [
  { nombre: 'Nissan Blanca', es: /nissan\s*blanca/i },
  { nombre: 'Nissan Roja', es: /nissan\s*roja/i },
  { nombre: 'RAM', es: /^ram\b/i },
  { nombre: 'Ford F450', es: /f\s*-?\s*450/i },
  { nombre: 'Torton', es: /torton/i },
];
const OTRAS = 'Sin unidad u otras';
const EL_AVISA = '9999-12-31'; // "Él avisa": sin día fijo (notas.repo.js)
const VIAJES = ['1er', '2do', '3er', '4to', '5to'];
// Notas con camión pero sin viaje anotado (asignadas desde el tablero) se ven en el 1er viaje.
const viajeDe = (n) => Math.min(Math.max(Number(n.viaje) || 1, 1), VIAJES.length);

export const dia = (desplazar = 0) => {
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

// Mismo paso que en Notas pendientes (y misma confirmación antes de salir a ruta).
function botonEstatus(n) {
  const texto = n.estado === 'pendiente' ? 'Empezar a cargar ▶'
    : n.estado === 'cargando' ? (n.es_almacen ? 'Marcar entregado ✓' : 'Enviar a ruta ▶')
      : n.estado === 'en_ruta' ? 'Marcar entregado ✓' : '';
  return texto ? `<button type="button" class="btn corcho__avanzar corcho__avanzar--${n.estado}" data-avanzar>${texto}</button>` : '';
}

// Lo mismo que en Notas pendientes: chofer (el camión lo da la columna), envío parcial y otro día.
// Los manejan app.js y parcial.js por data-accion, igual que en el tablero.
function herramientas(n) {
  const editable = !n.saldo && ['pendiente', 'cargando'].includes(n.estado);
  if (!editable) return n.chofer ? `<p class="corcho__suave">👤 ${esc(n.chofer)}</p>` : '';
  return `
    <div class="corcho__chofer">${selector(n, 'chofer', ctx.catalogos.choferes)}</div>
    <div class="corcho__acciones">
      <button type="button" class="btn btn--secundario" data-accion="parcial" data-id="${n.id}">✂ Parcial</button>
      ${n.estado === 'pendiente' ? '<button type="button" class="btn btn--secundario" data-reprogramar>🔁 Reprogramar</button>' : ''}
    </div>`;
}

// Todo el material de la nota (todos los renglones); si es muy larga, se desplaza dentro de la tarjeta.
function tarjeta(n, { manana = false, futura = false } = {}) {
  const entregada = n.estado === 'entregado';
  const mover = !n.es_almacen && ['pendiente', 'cargando'].includes(n.estado) && (!futura || manana);
  return `
    <article class="corcho__nota${manana ? ' corcho__nota--manana' : ''}${entregada ? ' corcho__nota--entregado' : ''}${n.saldo ? ' corcho__nota--saldo' : ''}${futura ? '' : ` corcho__nota--e-${n.estado}`}" data-id="${n.id}" ${mover ? 'draggable="true"' : ''}>
      ${manana ? '<p class="corcho__alerta">⏰ Esta nota es para mañana</p>' : ''}
      ${n.saldo ? '<p class="corcho__alerta corcho__alerta--saldo">⚠ Saldo pendiente</p>' : ''}
      <button type="button" class="corcho__eliminar" data-accion="cancelar" data-id="${n.id}" title="Eliminar nota" aria-label="Eliminar nota ${esc(n.folio)}">🗑</button>
      <header><b>${esc(n.folio)}</b>${botonEtiqueta(n)}${futura ? (n.camion && !manana ? `<span class="corcho__chip">${esc(n.camion)}</span>` : '') : `<span class="corcho__chip corcho__chip--${n.estado}">${NOMBRE_ESTADO[n.estado] ?? esc(n.estado)}</span>`}</header>
      <p class="corcho__cliente">${esc(n.cliente)}</p>
      <div class="corcho__material">${renglones(n)}</div>
      <p class="corcho__suave">📍 ${esc(n.zona || n.direccion)}</p>
      ${futura ? '' : herramientas(n)}
      ${futura ? '' : botonEstatus(n)}
      ${futura && manana ? `
        <div class="corcho__acciones">
          <button type="button" class="btn btn--secundario" data-reprogramar>🔁 Reprogramar</button>
          <button type="button" class="btn btn--secundario" data-hoy>↩ A hoy</button>
        </div>` : ''}
      ${futura && !manana ? `
        <div class="corcho__acciones corcho__fecha">
          <label>Fecha del cliente <input type="date" value="${n.programada_para === EL_AVISA ? '' : n.programada_para}" min="${dia(1)}" data-fecha></label>
          <label class="corcho__avisa"><input type="checkbox" data-avisa${n.programada_para === EL_AVISA ? ' checked' : ''}> 📞 Él avisa</label>
        </div>
        <div class="corcho__acciones">
          <button type="button" class="btn btn--secundario" data-hoy>↩ Reparto del día</button>
          <button type="button" class="btn btn--secundario" data-a-manana>⏰ Reparto de mañana</button>
        </div>` : ''}
    </article>`;
}

// Cuadrícula unidad × viaje. Hoy: las entregadas se quedan en su viaje, en verde, como registro del día
// (se archivan con el Cierre de Jornada). Mañana: se acomodan con anticipación y mañana ya salen así.
function rejilla(notas, opciones = {}) {
  const columnas = [...UNIDADES.map((u) => u.nombre), OTRAS];
  return columnas.map((nombre) => {
    const suyas = notas.filter((n) => columnaDe(n) === nombre);
    const entregadas = suyas.filter((n) => n.estado === 'entregado').length;
    const m3 = suyas.filter((n) => /m³|m3/i.test(n.unidad ?? '') && Number(n.cantidad)).reduce((t, n) => t + Number(n.cantidad), 0);
    return `
      <section class="corcho__columna${nombre === OTRAS ? ' corcho__columna--otras' : ''}">
        <h3>${nombre === OTRAS ? '' : '🚚 '}${esc(nombre)}</h3>
        <p class="corcho__cuenta">${suyas.length} ${suyas.length === 1 ? 'nota' : 'notas'}${entregadas ? ` · <span class="corcho__ok">${entregadas} entregada${entregadas === 1 ? '' : 's'}</span>` : ''}${m3 ? ` · ${Math.round(m3 * 10) / 10} m³` : ''}</p>
        ${nombre === OTRAS
    ? `<div class="corcho__zona corcho__zona--otras" data-zona data-columna="${esc(nombre)}">${suyas.map((n) => tarjeta(n, opciones)).join('') || '<p class="corcho__vacio">Sin notas</p>'}</div>`
    : VIAJES.map((v, k) => {
      const delViaje = suyas.filter((n) => viajeDe(n) === k + 1);
      const listo = delViaje.length && delViaje.every((n) => n.estado === 'entregado');
      return `
            <div class="corcho__zona corcho__viaje${listo ? ' corcho__viaje--listo' : ''}" data-zona data-columna="${esc(nombre)}" data-viaje="${k + 1}">
              <h4>${v} viaje${delViaje.length ? ` <span>${listo ? '✓ ' : ''}${delViaje.length}</span>` : ''}</h4>
              ${delViaje.map((n) => tarjeta(n, opciones)).join('')}
            </div>`;
    }).join('')}
      </section>`;
  }).join('');
}

function pintarDia() {
  $('#corcho-fecha').textContent = fechaLarga(dia());
  $('#corcho-contenido').innerHTML = rejilla(notasDelDia);
}

function pintarFuturas() {
  const manana = dia(1);
  $('#manana-fecha').textContent = fechaLarga(manana);
  $('#manana-contenido').innerHTML = rejilla(programadas.filter((n) => n.programada_para === manana), { futura: true, manana: true });
  // Por Confirmar · Otro día: primero "Él avisa" (sin día), luego por fecha después de mañana.
  const otras = programadas.filter((n) => n.programada_para !== manana);
  const fechas = [...new Set(otras.map((n) => n.programada_para))].sort((a, b) => (a === EL_AVISA ? -1 : b === EL_AVISA ? 1 : a.localeCompare(b)));
  $('#futuras-contenido').innerHTML = fechas.map((f) => `
    <section class="corcho__columna${f === EL_AVISA ? ' corcho__columna--avisa' : ''}">
      <h3>${f === EL_AVISA ? '📞 Él avisa · por confirmar' : esc(fechaLarga(f))}</h3>
      ${otras.filter((n) => n.programada_para === f).map((n) => tarjeta(n, { futura: true })).join('')}
    </section>`).join('') || '<p class="corcho__vacio">Ninguna nota por confirmar ni para otro día.</p>';
  // Para programar: las pendientes de hoy.
  const select = $('#futuras-nota');
  const elegida = select.value;
  select.innerHTML = '<option value="">Elige la nota…</option>' + notasDelDia
    .filter((n) => n.estado === 'pendiente')
    .map((n) => `<option value="${n.id}">${esc(n.folio)} · ${esc(n.cliente)} · ${esc(n.material)}</option>`).join('');
  select.value = elegida;
  $('#futuras-fecha').min = manana;
}

async function cargarFuturas(pintar = true) {
  try {
    programadas = await api.get('/api/notas/programadas');
    const manana = dia(1);
    const cuenta = (fn) => programadas.filter(fn).length;
    $('#pestana-manana-n').textContent = cuenta((x) => x.programada_para === manana);
    $('#pestana-futuras-n').textContent = cuenta((x) => x.programada_para !== manana);
    if (pintar) pintarFuturas();
  } catch (err) {
    ctx.toast(`No se cargaron las notas para otro día: ${err.message}`, true);
  }
}

async function programar(id, fecha) {
  try {
    const nota = await api.patch(`/api/notas/${id}/programar`, { fecha });
    ctx.toast(fecha === 'avisa' ? `${nota.folio} pasó a Por Confirmar · Otro día (él avisa)` : fecha ? `${nota.folio} quedó para el ${fechaLarga(fecha)}` : `${nota.folio} regresó a hoy`);
  } catch (err) {
    ctx.toast(err.message, true);
  }
  await cargarFuturas(); // el tablero se repinta solo por el aviso del servidor
}

// Soltar en un viaje de una unidad = cambiarle camión y número de viaje (mismas reglas que el tablero).
async function cambiarUnidad(id, columna, viaje) {
  const nota = [...notasDelDia, ...programadas].find((n) => n.id === id);
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

// Pestañas exclusivas: sólo una vista a la vez, a pantalla completa.
let activa = 'corcho';
let formatoDia = 'corcho'; // 'corcho' | 'notas': el último que eligieron en Reparto del día
function mostrar(pestana) {
  if (pestana === 'corcho' || pestana === 'notas') {
    if (pestana === 'corcho') pestana = formatoDia; // la pestaña abre el formato que estaban usando
  }
  activa = pestana;
  const delDia = pestana === 'corcho' || pestana === 'notas';
  document.querySelectorAll('#ventana-notas [data-pestana]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.pestana === (delDia ? 'corcho' : pestana))));
  $('#formato-dia').hidden = !delDia;
  document.querySelectorAll('#formato-dia [data-formato]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.formato === pestana)));
  document.querySelectorAll('#ventana-notas .operacion__vista').forEach((v) => { v.hidden = v.id !== `vista-${pestana}`; });
  $('#ventana-notas [data-ver-historial]').hidden = pestana !== 'notas';
  if (pestana === 'corcho') pintarDia();
  if (['manana', 'futuras'].includes(pestana)) cargarFuturas();
}

export function montarCorcho({ catalogos, toast, avanzar }) {
  ctx = { catalogos, toast, avanzar };
  const ventana = $('#ventana-notas');
  ventana.addEventListener('pestana', (e) => mostrar(e.detail));
  ventana.addEventListener('click', (e) => {
    const p = e.target.closest('[data-pestana]');
    if (p) mostrar(p.dataset.pestana);
    const f = e.target.closest('[data-formato]');
    if (f) {
      formatoDia = f.dataset.formato;
      mostrar(formatoDia);
    }
  });

  // Arrastrar: en el corcho de hoy y en el de mañana (acomodar con anticipación).
  for (const contenido of [$('#corcho-contenido'), $('#manana-contenido')]) {
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
  }
  const contenido = $('#corcho-contenido');
  contenido.addEventListener('click', async (e) => {
    const boton = e.target.closest('[data-avanzar]');
    if (boton) {
      boton.disabled = true;
      if (!(await ctx.avanzar(boton.closest('[data-id]').dataset.id))) boton.disabled = false;
    }
  });

  $('#futuras-nueva').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = $('#futuras-nota').value;
    const fecha = $('#futuras-fecha').value;
    if (!id || !fecha) return toast('Elige la nota y la fecha', true);
    $('#futuras-nueva').reset();
    programar(id, fecha);
  });
  // Reprogramar, fecha del cliente, "Él avisa" y regresar a hoy o a mañana: en cualquier pestaña.
  const ventana2 = $('#ventana-notas');
  const idDe = (el) => el.closest('[data-id]').dataset.id;
  ventana2.addEventListener('change', (e) => {
    if (e.target.matches('[data-fecha]') && e.target.value) programar(idDe(e.target), e.target.value);
    if (e.target.matches('[data-avisa]')) {
      if (e.target.checked) programar(idDe(e.target), 'avisa');
      else {
        e.target.checked = true; // sin fecha no puede dejar de ser "Él avisa"
        e.target.closest('[data-id]').querySelector('[data-fecha]')?.focus();
        toast('Ponle la fecha del cliente para quitar «Él avisa»');
      }
    }
  });
  ventana2.addEventListener('click', (e) => {
    if (e.target.closest('[data-hoy]')) programar(idDe(e.target), null);
    if (e.target.closest('[data-a-manana]')) programar(idDe(e.target), dia(1));
    if (e.target.closest('[data-reprogramar]')) programar(idDe(e.target), 'avisa');
  });
}

// Cada vez que cambia el tablero: repinta lo que esté abierto.
export function recargarCorcho(notas) {
  notasDelDia = notas;
  if (!ctx) return;
  const abierta = $('#ventana-notas').open;
  const eligiendo = $('#corcho-contenido').contains(document.activeElement) && document.activeElement.tagName === 'SELECT';
  if (abierta && activa === 'corcho' && !arrastrada && !eligiendo) pintarDia();
  cargarFuturas(abierta && ['manana', 'futuras'].includes(activa) && !arrastrada && !$(`#vista-${activa}`).contains(document.activeElement));
}
