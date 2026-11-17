// Sulema pregunta por cada nota nueva (SICAR, Salidas o Pulpos): ¿Reparto del día, de mañana u Otro día?
// Las de SICAR antes: ¿envío o la cargan en Almacén? (Almacén: chofer ALMACÉN y ya no pregunta el día).
// Hoy o mañana: unidad y viaje, y queda acomodada en ese corcho. Otro día: a "Por Confirmar · Otro día".
// Sólo las que llegan con la Oficina abierta; las de antes no se preguntan. "✕ Ahora no" la deja en Pendiente.
import { api } from './api.js';
import { UNIDADES, dia, siguiente as diaDeReparto } from './corcho.js';

const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const VIAJES = ['1er', '2do', '3er', '4to', '5to', '6to', '7mo'];

let ctx = null;
let vistoHasta = null; // id más alto ya visto en esta pantalla
let cola = [];
let ultimas = new Map();
let actual = null; // { nota, cuando: 'hoy' | 'manana', camion }

const dialogo = () => $('#sulema-programar');
const sigueSinAcomodar = (n) => n && n.estado === 'pendiente' && !n.camion_id && !n.es_almacen;

function paso(cual) {
  $('#sp-paso-tipo').hidden = cual !== 'tipo';
  $('#sp-paso-dia').hidden = cual !== 'dia';
  $('#sp-paso-viaje').hidden = cual !== 'viaje';
  $('#sp-aviso').textContent = '';
}

function mostrar(nota) {
  actual = { nota, cuando: null, camion: null };
  $('#sp-nota').innerHTML = `<b>${esc(nota.folio)}</b> · ${esc(nota.cliente)}<br><small>${esc(nota.cantidad)} ${esc(nota.unidad)} ${esc(nota.material)} · 📍 ${esc(nota.zona || nota.direccion)}</small>`;
  // Sólo las unidades que existen en la lista de camiones.
  $('#sp-unidades').innerHTML = UNIDADES
    .map((u) => ({ u, camion: ctx.catalogos.camiones.find((c) => u.es.test(c.nombre)) }))
    .filter((x) => x.camion)
    .map((x) => `<button type="button" class="btn btn--secundario" data-sp-camion="${x.camion.id}">🚚 ${esc(x.u.nombre)}</button>`).join('');
  paso(nota.origen === 'sicar' ? 'tipo' : 'dia'); // las de SICAR: primero ¿envío o Almacén?
  if (!dialogo().open) dialogo().showModal();
}

function siguiente() {
  actual = null;
  while (cola.length) {
    const n = ultimas.get(cola.shift());
    if (sigueSinAcomodar(n)) return mostrar(n);
  }
  if (dialogo().open) dialogo().close();
}

async function guardar(viaje) {
  const { nota, cuando, camion } = actual;
  if (!camion) return ($('#sp-aviso').textContent = 'Elige la unidad.');
  try {
    if (cuando === 'manana') await api.patch(`/api/notas/${nota.id}/programar`, { fecha: diaDeReparto() });
    await api.patch(`/api/notas/${nota.id}/viaje`, { camion_id: camion, viaje });
    const unidad = ctx.catalogos.camiones.find((c) => c.id === camion)?.nombre ?? '';
    ctx.toast(`${nota.folio} → ${cuando === 'manana' ? 'Reparto de mañana' : 'Reparto del día'} · ${unidad} · ${VIAJES[viaje - 1]} viaje`);
    siguiente();
  } catch (err) {
    $('#sp-aviso').textContent = err.message;
  }
}

// La cargan en Almacén: chofer ALMACÉN, sin camión; sale de la hoja de reparto y no avisa al cliente.
async function almacen() {
  const chofer = ctx.catalogos.choferes.find((c) => c.almacen);
  if (!chofer) return ($('#sp-aviso').textContent = 'No hay chofer ALMACÉN en la lista de choferes.');
  try {
    await api.patch(`/api/notas/${actual.nota.id}/chofer`, { chofer_id: chofer.id });
    ctx.toast(`${actual.nota.folio} → 🏬 Cargan en Almacén`);
    siguiente();
  } catch (err) {
    $('#sp-aviso').textContent = err.message;
  }
}

async function otroDia() {
  try {
    await api.patch(`/api/notas/${actual.nota.id}/programar`, { fecha: 'avisa' });
    ctx.toast(`${actual.nota.folio} → Por Confirmar · Otro día`);
    siguiente();
  } catch (err) {
    $('#sp-aviso').textContent = err.message;
  }
}

export function montarProgramarNueva({ catalogos, toast }) {
  ctx = { catalogos, toast };
  $('#sp-viajes').innerHTML = VIAJES.map((v, k) => `<button type="button" class="btn btn--secundario" data-sp-viaje="${k + 1}">${v} viaje</button>`).join('');
  dialogo().addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !actual) return;
    if (b.dataset.spTipo === 'almacen') return almacen();
    if (b.dataset.spTipo === 'envio') return paso('dia');
    if (b.dataset.spDia === 'otro') return otroDia();
    if (b.dataset.spDia) {
      actual.cuando = b.dataset.spDia;
      $('#sp-cuando').textContent = actual.cuando === 'manana' ? '⏰ Reparto de mañana' : '🚚 Reparto del día';
      dialogo().querySelectorAll('[data-sp-camion]').forEach((x) => x.classList.remove('sp--elegido'));
      actual.camion = null;
      return paso('viaje');
    }
    if (b.dataset.spCamion) {
      actual.camion = Number(b.dataset.spCamion);
      dialogo().querySelectorAll('[data-sp-camion]').forEach((x) => x.classList.toggle('sp--elegido', x === b));
      $('#sp-aviso').textContent = '';
      return;
    }
    if (b.dataset.spViaje) return guardar(Number(b.dataset.spViaje));
    if (b.hasAttribute('data-sp-atras')) return paso('dia');
    if (b.hasAttribute('data-sp-despues')) siguiente(); // se queda en Pendiente
  });
  dialogo().addEventListener('cancel', (e) => { e.preventDefault(); siguiente(); }); // Esc = ahora no
}

// En cada refresco del tablero: forma las notas que acaban de llegar.
export function revisarNuevas(notas) {
  if (!ctx) return;
  ultimas = new Map(notas.map((n) => [n.id, n]));
  const maxId = notas.reduce((m, n) => Math.max(m, n.id), 0);
  if (vistoHasta === null) {
    vistoHasta = maxId; // al abrir la Oficina no pregunta por las que ya estaban
    return;
  }
  const nuevas = notas.filter((n) => n.id > vistoHasta && sigueSinAcomodar(n)).map((n) => n.id);
  vistoHasta = Math.max(vistoHasta, maxId);
  cola.push(...nuevas);
  // Si otra pantalla ya la acomodó (o se borró), pasa a la siguiente.
  if (actual && !sigueSinAcomodar(ultimas.get(actual.nota.id))) siguiente();
  else if (!actual && cola.length) siguiente();
}
