import { api } from './api.js';
import { montarOficina, actualizarOficina, actualizarConectores, actualizarFlota, animarSalida } from './oficina.js';
import { montarPizarron, recargarPizarron } from './pizarron.js';
import { montarAsistencias, recargarAsistencias } from './asistencias.js';
import { renderKanban, faltaDireccion } from './kanban.js';
import { montarCaptura } from './captura.js';
import { montarEditarNota } from './editar-nota.js';
import { montarParcial } from './parcial.js';
import { montarEntregaPasada } from './entrega-pasada.js';
import { montarWhatsapp } from './whatsapp-ventana.js';
import { montarVisorFoto } from './visor-foto.js';
import { montarCierre } from './cierre.js';
import { montarInspector, recargarSolicitudes } from './inspector.js';
import { montarOctavio, recargarOctavio } from './octavio.js';
import { montarArchiveros } from './archiveros.js';
import { montarCorcho, recargarCorcho, siguiente } from './corcho.js';
import { montarProgramarNueva, revisarNuevas } from './programar-nueva.js';
import { normalizar, formatear } from './telefono.js';

const INTERVALO_MS = 60000; // respaldo; los cambios llegan al instante por /api/eventos
const NOMBRE_ESTADO = { pendiente: 'Pendiente', cargando: 'Cargando', en_ruta: 'En Ruta', entregado: 'Entregado' };
// Mismas reglas que el servidor (notas.repo.js): un paso adelante o un paso atrás.
const SIGUIENTE = { pendiente: 'cargando', cargando: 'en_ruta', en_ruta: 'entregado' };
const ANTERIOR = { cargando: 'pendiente', en_ruta: 'cargando', entregado: 'en_ruta' };
// Quien recoge en ALMACÉN no pasa por En Ruta.
const siguienteDe = (n) => (n.es_almacen && n.estado === 'cargando' ? 'entregado' : SIGUIENTE[n.estado]);
const anteriorDe = (n) => (n.es_almacen && n.estado === 'entregado' ? 'cargando' : ANTERIOR[n.estado]);
const $ = (sel) => document.querySelector(sel);
const tablero = $('#tablero');
const catalogos = { choferes: [], camiones: [] };
let notasActuales = [];
let whatsappConectado = false;

function toast(mensaje, error = false) {
  const el = $('#toast');
  el.textContent = mensaje;
  el.classList.toggle('error', error);
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 3500);
}

// Botón "Punto de Venta": en la PC del servidor (Mostrador) abre o trae al frente la ventana que imprime directo;
// en cualquier otra PC (o si no se puede) abre el POS normal en esta pestaña.
document.querySelector('.topbar__pos')?.addEventListener('click', async (e) => {
  if (e.ctrlKey || e.shiftKey || e.metaKey || e.button !== 0) return;
  e.preventDefault();
  const destino = e.currentTarget.href;
  try {
    const { ventana } = await api.post('/api/pos/ventana');
    toast(ventana === 'nueva' ? 'Abriendo el Punto de Venta…' : 'El Punto de Venta ya está abierto');
  } catch {
    location.href = destino;
  }
});

function setConexion(ok) {
  const el = $('#conexion');
  el.textContent = ok ? 'En línea' : 'Sin conexión';
  el.className = `badge ${ok ? 'ok' : 'error'}`;
}

async function refrescar() {
  // No re-renderizar mientras alguien está eligiendo chofer o arrastrando una tarjeta.
  if (arrastrando) return;
  // (en el tablero o en el corcho: los dos están en la ventana de reparto)
  if ($('#ventana-notas').contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
  try {
    const [notas, resumen] = await Promise.all([api.get('/api/notas'), api.get('/api/resumen')]);
    // Notas que acaban de salir de Cargando a En Ruta (aquí o desde otro equipo): sale el camión.
    const antes = new Map(notasActuales.map((n) => [n.id, n.estado]));
    notas
      .filter((n) => n.estado === 'en_ruta' && antes.get(n.id) === 'cargando')
      .forEach((n) => animarSalida(n));
    notasActuales = notas;
    renderKanban(tablero, notas, catalogos);
    recargarCorcho(notas);
    revisarNuevas(notas);
    pintarSinDireccion(notas);
    actualizarOficina(resumen, notas);
    actualizarFlota(resumen.camiones);
    actualizarConectores($('#conectores'), resumen.integraciones);
    whatsappConectado = resumen.integraciones?.whatsapp?.ok === true;
    setConexion(true);
  } catch (err) {
    console.error('[refrescar]', err);
    setConexion(false);
  }
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Panel de Sulema: notas que esperan su dirección, a un clic de completarla.
function pintarSinDireccion(notas) {
  const faltan = notas.filter(faltaDireccion);
  $('#sin-direccion').hidden = !faltan.length;
  $('#sin-direccion-lista').innerHTML = faltan.map((n) => `
    <li><span><b>${esc(n.folio)}</b> · ${esc(n.cliente)}</span>
      <button type="button" class="btn btn--ruta" data-accion="editar" data-foco="direccion" data-id="${n.id}">📍 Completar dirección</button></li>`).join('');
}

// Ventana de confirmación antes de salir a ruta (es lo que dispara el WhatsApp al cliente).
// Permite escribir o corregir el teléfono. Resuelve true sólo si se presiona "Sí, va en camino"
// y, si se cambió el teléfono, éste se guardó.
const telefonoInput = $('#confirmar-telefono');
const botonConfirmar = $('#confirmar-ruta button[value="confirmar"]');

const noAvisar = $('#confirmar-no-avisar');
function avisoTelefono() {
  if (noAvisar.checked) {
    $('#confirmar-whatsapp').textContent = '🔕 No se le mandará WhatsApp al cliente.';
    $('#confirmar-whatsapp').classList.remove('dialogo__aviso--error');
    botonConfirmar.disabled = false;
    return;
  }
  const texto = telefonoInput.value.trim();
  const telefono = normalizar(texto);
  const valido = !texto || telefono;
  $('#confirmar-whatsapp').textContent = !texto
    ? 'Sin teléfono: no se enviará WhatsApp.'
    : !telefono
      ? 'Revisa el número: deben ser 10 dígitos (ej. 981 196 5122).'
      : whatsappConectado
        ? `Se le avisará por WhatsApp al ${formatear(telefono)} que su pedido va en camino.`
        : `WhatsApp no está conectado: el aviso al ${formatear(telefono)} se mandará al reconectar.`;
  $('#confirmar-whatsapp').classList.toggle('dialogo__aviso--error', !valido);
  botonConfirmar.disabled = !valido;
}
telefonoInput.addEventListener('input', avisoTelefono);
noAvisar.addEventListener('change', avisoTelefono);

let abrirParcial = async () => false; // se conecta al montar la ventana Parcial

// "¿El material está saliendo completo?" Devuelve la nota lista para salir (la misma o ya dividida) o null.
async function salidaCompleta(nota) {
  const dialogo = $('#salida-completa');
  $('#salida-completa-resumen').innerHTML = `
    <div><b>${esc(nota.folio)}</b> · ${esc(nota.cliente)}</div>
    <div>${esc(nota.cantidad)} ${esc(nota.unidad)} · ${esc(nota.material)}</div>`;
  dialogo.returnValue = '';
  dialogo.showModal();
  const respuesta = await new Promise((listo) => {
    dialogo.addEventListener('close', () => listo(dialogo.returnValue), { once: true });
  });
  if (respuesta === 'si') return nota;
  if (respuesta !== 'no' || !(await abrirParcial(nota))) return null;
  const dividida = notaPorId(nota.id);
  if (!dividida || dividida.saldo) {
    toast(`${nota.folio}: no salió nada, quedó en Saldos pendientes`);
    return null;
  }
  return dividida;
}

async function confirmarRuta(nota) {
  const dialogo = $('#confirmar-ruta');
  $('#confirmar-resumen').innerHTML = `
    <div><b>${esc(nota.folio)}</b> · ${esc(nota.cliente)}</div>
    <div>${esc(nota.cantidad)} ${esc(nota.unidad)} · ${esc(nota.material)}</div>
    <div>📍 ${esc(nota.direccion)}</div>
    <div>🚚 ${esc(nota.chofer)} · ${esc(nota.camion)}</div>`;
  telefonoInput.value = formatear(nota.cliente_telefono);
  noAvisar.checked = false; // cada salida pregunta de nuevo: por omisión sí se avisa
  avisoTelefono();
  dialogo.returnValue = '';
  dialogo.showModal();
  const confirmado = await new Promise((listo) => {
    dialogo.addEventListener('close', () => listo(dialogo.returnValue === 'confirmar'), { once: true });
  });
  if (!confirmado) return false;
  if (noAvisar.checked) return { avisar: false };

  const telefono = normalizar(telefonoInput.value);
  if ((telefono ?? null) !== (nota.cliente_telefono || null)) {
    try {
      await api.patch(`/api/notas/${nota.id}/telefono`, { telefono: telefonoInput.value });
    } catch (err) {
      toast(`No se guardó el teléfono: ${err.message}`, true);
      return false;
    }
  }
  return { avisar: true };
}

// Mueve una nota a la columna destino (un paso adelante o atrás). Botones y arrastre usan
// esta misma función, así que comparten reglas y confirmación. Devuelve true si se movió.
async function mover(nota, destino) {
  const regresar = destino === anteriorDe(nota);
  if (!regresar && destino !== siguienteDe(nota)) {
    toast(`${nota.folio}: de ${NOMBRE_ESTADO[nota.estado]} sólo puede ir a ${NOMBRE_ESTADO[siguienteDe(nota)] ?? 'ningún lado'}`
      + (anteriorDe(nota) ? ` o regresar a ${NOMBRE_ESTADO[anteriorDe(nota)]}` : ''), true);
    return false;
  }
  const aRuta = destino === 'en_ruta' && !regresar;
  if (aRuta && !(nota = await salidaCompleta(nota))) return false;
  const ruta = aRuta ? await confirmarRuta(nota) : null;
  if (aRuta && !ruta) return false;
  try {
    const actualizada = regresar
      ? await api.patch(`/api/notas/${nota.id}/regresar`)
      : await api.patch(`/api/notas/${nota.id}/estado`, { estado: destino, confirmado: aRuta || undefined, avisar: ruta?.avisar });
    toast(`${actualizada.folio} ${regresar ? '↩ regresó a' : '→'} ${NOMBRE_ESTADO[actualizada.estado]}`);
    await refrescar();
    return true;
  } catch (err) {
    toast(err.message, true);
    return false;
  }
}

const notaPorId = (id) => notasActuales.find((n) => String(n.id) === String(id));

$('#ventana-notas').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-accion="avanzar"], button[data-accion="regresar"]');
  if (!btn) return;
  const nota = notaPorId(btn.dataset.id);
  btn.disabled = true;
  const destino = btn.dataset.accion === 'regresar' ? anteriorDe(nota) : btn.dataset.estado;
  if (!(await mover(nota, destino))) btn.disabled = false;
});

// Clic en la etiqueta: cambia a SALIDA y de regreso (SC o la de su origen).
$('#ventana-notas').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-accion="etiqueta"]');
  if (!btn) return;
  btn.disabled = true;
  try {
    await api.patch(`/api/notas/${btn.dataset.id}/etiqueta`, { etiqueta: btn.dataset.etiqueta });
    await refrescar();
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
  }
});

// Saldos Pendientes: la nota regresa a Pendiente para asignarle chofer y camión (tablero o corcho).
$('#ventana-notas').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-accion="reprogramar"]');
  if (!btn) return;
  btn.disabled = true;
  try {
    const nota = await api.post(`/api/notas/${btn.dataset.id}/reprogramar`);
    toast(`${nota.folio} → Pendiente`);
    await refrescar();
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
  }
});

// 🗓 Otro día: elige la fecha y la nota pasa al corcho «Notas para otro día» (sale de Pendientes).
const diaLocal = (mas) => {
  const d = new Date();
  d.setDate(d.getDate() + mas);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// 🔁 Reprogramar (tablero y corcho, también las de mañana): Mañana, Cliente avisa o Con fecha.
$('#ventana-notas').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-accion="otro-dia"]');
  if (!btn) return;
  const nota = notaPorId(btn.dataset.id)
    ?? (await api.get('/api/notas/programadas').catch(() => [])).find((n) => String(n.id) === btn.dataset.id);
  if (!nota) return;
  const dialogo = $('#otro-dia');
  const fecha = $('#otro-dia-fecha');
  $('#otro-dia-resumen').innerHTML = `<div><b>${esc(nota.folio)}</b> · ${esc(nota.cliente)}</div><div>${esc(nota.cantidad)} ${esc(nota.unidad)} · ${esc(nota.material)}</div>`;
  fecha.min = diaLocal(2); // mañana tiene su propio botón
  fecha.value = '';
  dialogo.returnValue = '';
  dialogo.showModal();
  await new Promise((listo) => dialogo.addEventListener('close', listo, { once: true }));
  const opcion = dialogo.returnValue;
  if (!['manana', 'avisa', 'confirmar'].includes(opcion) || (opcion === 'confirmar' && !fecha.value)) return;
  try {
    const cuerpo = opcion === 'manana' ? { fecha: siguiente() }
      : opcion === 'avisa' ? { fecha: 'avisa' }
        : { fecha: fecha.value, con_fecha: true };
    await api.patch(`/api/notas/${nota.id}/programar`, cuerpo);
    const dia = opcion === 'confirmar' ? new Date(`${fecha.value}T12:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
    toast(opcion === 'manana' ? `${nota.folio} → Reparto de mañana`
      : opcion === 'avisa' ? `${nota.folio} → Por Confirmar · Otro día (cliente avisa)`
        : `${nota.folio} quedó para el ${dia}: Edgar avisa un día antes`);
  } catch (err) {
    toast(err.message, true);
  }
  refrescar();
  document.dispatchEvent(new Event('notas-programadas')); // el corcho recarga Mañana y Por Confirmar
});

// ✕ de cada tarjeta: pide confirmación antes de borrar.
async function confirmarCancelacion(nota) {
  const dialogo = $('#cancelar-nota');
  $('#cancelar-resumen').innerHTML = `<div>¿Seguro que quieres eliminar la nota <b>${esc(nota.folio)} · ${esc(nota.cliente)}</b>? No se puede deshacer.</div>`;
  $('#cancelar-aviso').textContent = nota.estado === 'entregado'
    ? 'Ya se entregó: su renglón también se borra de la hoja de reparto.'
    : nota.estado === 'en_ruta' ? 'Ya va en ruta y el cliente pudo recibir el aviso por WhatsApp.' : '';
  dialogo.returnValue = '';
  dialogo.showModal();
  return new Promise((listo) => {
    dialogo.addEventListener('close', () => listo(dialogo.returnValue === 'confirmar'), { once: true });
  });
}

// En el tablero y en los corchos (las de mañana u otro día no vienen en el tablero: se buscan aparte).
$('#ventana-notas').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-accion="cancelar"]');
  if (!btn) return;
  const nota = notaPorId(btn.dataset.id)
    ?? (await api.get('/api/notas/programadas').catch(() => [])).find((n) => String(n.id) === btn.dataset.id);
  if (!nota || !(await confirmarCancelacion(nota))) return;
  try {
    await api.delete(`/api/notas/${nota.id}`);
    toast(`${nota.folio} eliminada`);
    await refrescar();
  } catch (err) {
    toast(err.message, true);
  }
});

// ---- Arrastrar tarjetas entre columnas (escritorio; en celular se usan los botones) ----
let arrastrando = null;

tablero.addEventListener('dragstart', (e) => {
  const tarjeta = e.target.closest('.tarjeta');
  if (!tarjeta) return;
  arrastrando = notaPorId(tarjeta.dataset.id);
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', tarjeta.dataset.id);
  tarjeta.classList.add('arrastrando');
  for (const col of tablero.querySelectorAll('.columna')) {
    const destino = col.dataset.estado;
    col.classList.toggle('destino-valido', destino === siguienteDe(arrastrando) || destino === anteriorDe(arrastrando));
  }
});

tablero.addEventListener('dragend', () => {
  arrastrando = null;
  tablero.querySelectorAll('.arrastrando, .destino-valido, .encima')
    .forEach((el) => el.classList.remove('arrastrando', 'destino-valido', 'encima'));
});

tablero.addEventListener('dragover', (e) => {
  const col = e.target.closest('.columna');
  if (!arrastrando || !col || col.dataset.estado === arrastrando.estado) return;
  e.preventDefault(); // permite soltar; la validez la decide mover()
  tablero.querySelectorAll('.encima').forEach((el) => el !== col && el.classList.remove('encima'));
  col.classList.add('encima');
});

tablero.addEventListener('drop', async (e) => {
  const col = e.target.closest('.columna');
  if (!arrastrando || !col) return;
  e.preventDefault();
  const nota = arrastrando;
  tablero.dispatchEvent(new Event('dragend'));
  await mover(nota, col.dataset.estado);
});

// Chofer y camión: en el tablero y en las tarjetas del corcho.
$('#ventana-notas').addEventListener('change', async (e) => {
  const select = e.target.closest('select[data-accion="chofer"], select[data-accion="camion"]');
  if (!select) return;
  const campo = select.dataset.accion;
  try {
    await api.patch(`/api/notas/${select.dataset.id}/${campo}`, { [`${campo}_id`]: select.value || null });
    select.blur();
    await refrescar();
  } catch (err) {
    toast(err.message, true);
  }
});

// Viaje desde Notas pendientes: misma ruta que al arrastrar en el corcho.
$('#ventana-notas').addEventListener('change', async (e) => {
  const select = e.target.closest('select[data-accion="viaje"]');
  if (!select) return;
  try {
    await api.patch(`/api/notas/${select.dataset.id}/viaje`, { camion_id: Number(select.dataset.camion), viaje: Number(select.value) });
    select.blur();
    await refrescar();
  } catch (err) {
    toast(err.message, true);
  }
});

// Tiempo real: el servidor avisa cuando cambia el tablero o el pizarrón (EventSource se reconecta solo).
function escucharEventos() {
  const eventos = new EventSource('/api/eventos');
  eventos.addEventListener('tablero', () => refrescar());
  eventos.addEventListener('pizarron', () => recargarPizarron());
  eventos.addEventListener('asistencia', () => { recargarAsistencias(); refrescar(); }); // incluye el aviso de las 10:00
  eventos.addEventListener('inspector', () => { recargarSolicitudes(); refrescar(); }); // llegó/cambió una solicitud por WhatsApp
  eventos.addEventListener('octavio', () => { recargarOctavio(); refrescar(); }); // llegó/cambió una orden de compra
  eventos.addEventListener('open', () => setConexion(true));
  eventos.addEventListener('error', () => setConexion(false));
}

$('#salir-pin').addEventListener('click', async () => {
  await fetch('/api/pin/salir', { method: 'POST' }).catch(() => {});
  location.replace('/login.html');
});

function reloj() {
  $('#reloj').textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

async function iniciar() {
  montarOficina($('#escena'));
  montarPizarron(toast);
  montarAsistencias(toast);
  escucharEventos();
  montarCaptura({ alGuardar: refrescar, toast });
  montarEditarNota({ notaPorId, catalogos, alGuardar: refrescar, toast });
  abrirParcial = montarParcial({ notaPorId, alGuardar: refrescar, toast });
  montarEntregaPasada({ notaPorId, catalogos, alGuardar: refrescar, toast });
  montarWhatsapp({ toast });
  montarVisorFoto();
  montarCierre({ notasActuales: () => notasActuales, alCerrar: refrescar, toast });
  montarInspector({ toast, alAprobar: refrescar });
  montarOctavio({ toast, alCambiar: refrescar });
  montarArchiveros();
  montarProgramarNueva({ catalogos, toast });
  montarCorcho({ catalogos, toast, parcial: (n) => abrirParcial(n), avanzar: (id) => { const n = notaPorId(id); return n ? mover(n, siguienteDe(n)) : false; } });
  reloj();
  setInterval(reloj, 30000);
  try {
    [catalogos.choferes, catalogos.camiones] = await Promise.all([api.get('/api/choferes'), api.get('/api/camiones')]);
  } catch {
    setConexion(false);
  }
  await refrescar();
  setInterval(refrescar, INTERVALO_MS);
}

iniciar();
