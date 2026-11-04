const ACCIONES = {
  pendiente: { siguiente: 'cargando', texto: 'Empezar a cargar ▶' },
  cargando: { siguiente: 'en_ruta', texto: 'Enviar a ruta ▶' },
  en_ruta: { siguiente: 'entregado', texto: 'Marcar entregado ✔' },
};
// Estado del aviso "va en camino" (tabla whatsapp_envios).
const AVISO_WHATSAPP = {
  enviado: '💬 WhatsApp enviado',
  pendiente: '⏳ WhatsApp pendiente (sin conexión)',
  sin_telefono: '💬 Sin teléfono: no se avisó',
  no_whatsapp: '💬 Ese número no tiene WhatsApp',
  error: '⚠️ WhatsApp falló',
};
// Registro de la entrega en Google Sheets (tabla sheets_registros).
const REGISTRO_SHEETS = {
  registrado: '📊 Registrada en Sheets',
  pendiente: '⏳ Sheets pendiente',
  error: '⚠️ Sheets falló (se reintenta)',
};
// Paso al que regresa cada estado con "↩ Regresar".
const REGRESAR_A = { cargando: 'Pendiente', en_ruta: 'Cargando', entregado: 'En Ruta' };
// Antes de salir a ruta todavía se puede elegir o cambiar el chofer.
const CHOFER_EDITABLE = ['pendiente', 'cargando'];

import { formatear } from './telefono.js';
import { miniaturaFoto } from './visor-foto.js';

const ORIGENES = { pulpos: 'PS', sicar: 'SC', whatsapp: 'WA' };

// Etiqueta de la tarjeta. Las notas capturadas a mano con folio de N001 a N1000 son de SALIDA, no de SICAR.
export function etiquetaOrigen(nota) {
  const m = /^n0*(\d+)(?:-s\d+)?$/i.exec(String(nota.folio ?? '').trim());
  if (nota.origen === 'sicar') {
    // La elegida a mano manda sobre la que toca por folio.
    const salida = nota.etiqueta ? nota.etiqueta === 'SALIDA' : Boolean(m && Number(m[1]) >= 1 && Number(m[1]) <= 1000);
    return salida ? { texto: 'SALIDA', clase: 'salida' } : { texto: 'SC', clase: 'sicar' };
  }
  return ORIGENES[nota.origen] ? { texto: ORIGENES[nota.origen], clase: nota.origen } : null;
}

const esc =(v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Mismas reglas que el servidor (notas.repo.js). A quien recoge en ALMACÉN no le hace falta dirección.
export const faltaDireccion = (n) => /^sin direcci[oó]n/i.test(n.direccion ?? '') && !n.es_almacen && n.estado !== 'entregado';
// Hora en que se hizo la nota; si no es de hoy, también el día ("28/10 08:05").
function hora(fecha) {
  if (!fecha) return '';
  const [dia, tiempo] = fecha.split(' ');
  const [a, m, d] = dia.split('-');
  const hoy = new Date();
  const esHoy = Number(a) === hoy.getFullYear() && Number(m) === hoy.getMonth() + 1 && Number(d) === hoy.getDate();
  return esHoy ? tiempo.slice(0, 5) : `${d}/${m} ${tiempo.slice(0, 5)}`;
}

// campo: 'chofer' | 'camion'. Se eligen por separado: no siempre va el mismo chofer en el mismo camión.
function selector(nota, campo, opciones) {
  const actual = nota[`${campo}_id`];
  const items = opciones.map((o) =>
    `<option value="${o.id}" ${o.id === actual ? 'selected' : ''}>${esc(o.nombre)}</option>`);
  return `
    <label class="campo">${campo === 'chofer' ? 'Chofer' : 'Camión'}
      <select data-accion="${campo}" data-id="${nota.id}">
        ${nota.estado === 'pendiente' || !actual ? '<option value="">— Sin asignar —</option>' : ''}${items.join('')}
      </select>
    </label>`;
}

// Un producto por renglón: con varios, la lista completa; el aviso de revisar va aparte y resaltado.
function renglones(nota) {
  const lineas = String(nota.detalle ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const avisos = lineas.filter((l) => l.startsWith('⚠️'));
  const productos = lineas.filter((l) => !l.startsWith('⚠️'));
  const lista = productos.length
    ? productos.map((l) => `<div class="material material--renglon">${esc(l.replace(/\s×\s/, ' · '))}</div>`).join('')
    : `<div class="material">${esc(nota.cantidad)} ${esc(nota.unidad)} ${esc(nota.material)}</div>`;
  return lista + avisos.map((a) => `<div class="partidas partidas--aviso">${esc(a)}</div>`).join('');
}

function tarjeta(nota, { choferes, camiones }) {
  const esSaldo = Boolean(nota.saldo);
  // Quien recoge en ALMACÉN no lleva camión y pasa de Cargando a Entregado, sin En Ruta.
  const accion = esSaldo ? null : nota.es_almacen && nota.estado === 'cargando'
    ? { siguiente: 'entregado', texto: 'Entregado en almacén ✔' }
    : ACCIONES[nota.estado];
  const regresarA = nota.es_almacen && nota.estado === 'entregado' ? 'Cargando' : REGRESAR_A[nota.estado];
  const faltaAsignar = !nota.chofer_id || (!nota.camion_id && !nota.es_almacen);
  const almacenHtml = nota.es_almacen ? '<div class="recoge-almacen">🏬 Recoge en almacén</div>' : '';
  const choferHtml = esSaldo ? '' : CHOFER_EDITABLE.includes(nota.estado)
    ? `<div class="asignacion">${selector(nota, 'chofer', choferes)}${nota.es_almacen ? '' : selector(nota, 'camion', camiones)}</div>${almacenHtml}`
    : almacenHtml || `<div class="dato">🚚 ${esc(nota.chofer)}${nota.camion ? ` · ${esc(nota.camion)}` : ''}</div>`;
  const bloqueo = CHOFER_EDITABLE.includes(nota.estado) && faltaAsignar
    ? 'Elige chofer y camión, o ALMACÉN'
    : accion?.siguiente === 'en_ruta' && faltaDireccion(nota) ? 'Falta la dirección de entrega' : '';
  const avanzar = accion
    ? `<button class="btn" data-accion="avanzar" data-id="${nota.id}" data-estado="${accion.siguiente}"
         ${bloqueo ? `disabled title="${bloqueo}"` : ''}>
         ${accion.texto}
       </button>`
    : '';
  const regresar = regresarA
    ? `<button class="btn btn--regresar" data-accion="regresar" data-id="${nota.id}"
         title="Deshacer: regresar a ${regresarA}">↩ Regresar</button>`
    : '';
  const reprogramar = esSaldo
    ? `<button class="btn" data-accion="reprogramar" data-id="${nota.id}">Re-programar en Pendientes 🚚</button>`
    : '';
  const boton = avanzar || regresar || reprogramar ? `<div class="tarjeta__acciones">${avanzar}${regresar}${reprogramar}</div>` : '';
  const parcial = !esSaldo && CHOFER_EDITABLE.includes(nota.estado)
    ? `<button type="button" class="tarjeta__editar" data-accion="parcial" data-id="${nota.id}">✂ Envío parcial</button>`
    : '';

  const origen = etiquetaOrigen(nota);
  return `
    <article class="tarjeta" data-id="${nota.id}" ${esSaldo ? '' : 'draggable="true" title="Arrástrala a otra columna o usa los botones"'}>
      <button type="button" class="tarjeta__cancelar" data-accion="cancelar" data-id="${nota.id}"
        title="Cancelar nota" aria-label="Cancelar nota ${esc(nota.folio)}">✕</button>
      <div class="tarjeta__top">
        <span class="folio">${esc(nota.folio)}</span>
        ${nota.origen === 'sicar'
    ? `<button type="button" class="origen origen--${origen.clase} origen--boton" data-accion="etiqueta" data-id="${nota.id}"
         data-etiqueta="${origen.texto === 'SC' ? 'SALIDA' : 'SC'}" title="Cambiar a ${origen.texto === 'SC' ? 'SALIDA' : 'SC'}">${origen.texto}</button>`
    : origen ? `<span class="origen origen--${origen.clase}">${origen.texto}</span>` : ''}
        <span class="hora" title="Hora de la venta">${hora(nota.creado_en)}</span>
      </div>
      <div class="cliente">${esc(nota.cliente)}</div>
      ${nota.cliente_telefono ? `<div class="dato">📱 ${formatear(nota.cliente_telefono)}</div>` : ''}
      <div class="auditoria">
        ${miniaturaFoto(nota.foto)}
        <div class="auditoria__texto">${renglones(nota)}</div>
      </div>
      ${faltaDireccion(nota)
    ? `<div class="sin-direccion__marca">⚠️ Sin Dirección</div>
       <button type="button" class="btn btn--ruta" data-accion="editar" data-foco="direccion" data-id="${nota.id}">📍 Completar dirección</button>`
    : `<div class="dato">📍 ${esc(nota.direccion)}${nota.zona ? ` (${esc(nota.zona)})` : ''}</div>`}
      <div class="tarjeta__enlaces">
        <button type="button" class="tarjeta__editar" data-accion="editar" data-id="${nota.id}">✎ Editar</button>
        ${parcial}
        ${nota.estado === 'pendiente' ? `<button type="button" class="tarjeta__editar" data-accion="otro-dia" data-id="${nota.id}">🗓 Otro día</button>` : ''}
      </div>
      ${choferHtml}
      ${AVISO_WHATSAPP[nota.whatsapp] ? `<div class="dato dato--whatsapp">${AVISO_WHATSAPP[nota.whatsapp]}</div>` : ''}
      ${nota.estado === 'entregado' && REGISTRO_SHEETS[nota.sheets] ? `<div class="dato">${REGISTRO_SHEETS[nota.sheets]}</div>` : ''}
      ${nota.evidencias ? `<div class="dato">📸 ${nota.estado === 'entregado' ? 'Entregada con evidencia' : 'Con foto de evidencia'}</div>` : ''}
      ${boton}
    </article>`;
}

// catalogos: { choferes, camiones }
export function renderKanban(tablero, notas, catalogos) {
  for (const columna of tablero.querySelectorAll('.columna')) {
    const lista = notas.filter((n) => (n.saldo ? 'saldo' : n.estado) === columna.dataset.estado);
    columna.querySelector('.contador').textContent = lista.length;
    columna.querySelector('.columna__lista').innerHTML = lista.length
      ? lista.map((n) => tarjeta(n, catalogos)).join('')
      : '<p class="vacio">Sin notas</p>';
  }
}
