// Cierre de Jornada: pide confirmación, archiva lo entregado y muestra cómo quedó el tablero.
// También el historial general de notas ya entregadas.
import { api } from './api.js';
import { etiquetaOrigen } from './kanban.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plural = (n, una, varias) => `${n} ${n === 1 ? una : varias}`;

export function montarCierre({ notasActuales, alCerrar, toast }) {
  const dialogo = document.querySelector('#cierre-jornada');
  const titulo = dialogo.querySelector('#cierre-titulo');
  const resumen = dialogo.querySelector('#cierre-resumen');
  const aviso = dialogo.querySelector('#cierre-aviso');
  const confirmar = dialogo.querySelector('[data-confirmar]');
  const cancelar = dialogo.querySelector('[data-cancelar]');
  const historial = document.querySelector('#ventana-historial');

  const verPregunta = () => {
    const notas = notasActuales();
    const cuantas = (estado) => notas.filter((n) => n.estado === estado && !n.saldo).length;
    const entregadas = notas.filter((n) => n.estado === 'entregado');
    const sinHoja = entregadas.filter((n) => n.sheets !== 'registrado').length;
    titulo.textContent = '🌙 ¿Cerrar la jornada?';
    resumen.innerHTML = `
      <div>📚 Al historial: <b>${plural(entregadas.length, 'nota entregada', 'notas entregadas')}</b></div>
      <div>📌 Se quedan igual: <b>${notas.filter((n) => n.saldo).length}</b> en Saldos, <b>${cuantas('pendiente')}</b> en Pendiente, <b>${cuantas('cargando')}</b> en Cargando y <b>${cuantas('en_ruta')}</b> en Ruta</div>`;
    aviso.textContent = sinHoja ? `${plural(sinHoja, 'entregada aún no está', 'entregadas aún no están')} en la hoja de reparto; se sigue reintentando.` : '';
    confirmar.hidden = false;
    confirmar.disabled = false;
    cancelar.textContent = 'Cancelar';
    dialogo.showModal();
  };

  const verResultado = ({ archivadas, deManana, conservadas: c, respaldo }) => {
    titulo.textContent = '✅ Jornada cerrada';
    resumen.innerHTML = `
      <div>📚 ${plural(archivadas, 'nota pasó', 'notas pasaron')} al historial</div>
      ${deManana ? `<div>🚚 ${plural(deManana, 'nota de mañana pasó', 'notas de mañana pasaron')} al Reparto del día</div>` : ''}
      <div>📌 Listo para mañana: <b>${c.saldos}</b> en Saldos, <b>${c.pendiente}</b> en Pendiente, <b>${c.cargando}</b> en Cargando y <b>${c.enRuta}</b> en Ruta</div>
      ${respaldo ? `<div>💾 Respaldo guardado: ${esc(respaldo)}</div>` : ''}`;
    aviso.textContent = respaldo ? '' : '⚠️ El cierre se hizo, pero el respaldo falló. Avísale a quien da soporte.';
    confirmar.hidden = true;
    cancelar.textContent = 'Listo';
  };

  document.querySelector('#abrir-cierre').addEventListener('click', verPregunta);
  cancelar.addEventListener('click', () => dialogo.close());

  confirmar.addEventListener('click', async () => {
    confirmar.disabled = true;
    try {
      verResultado(await api.post('/api/notas/cierre'));
      await alCerrar();
    } catch (err) {
      toast(err.message, true);
      confirmar.disabled = false;
    }
  });

  let vistas = new Map(); // id -> nota del historial que se ve
  const verHistorial = async () => {
    try {
      const notas = await api.get('/api/notas/historial');
      historial.querySelector('tbody').innerHTML = notas.length
        ? notas.map((n) => `
          <tr>
            <td>${esc(n.actualizado_en.slice(0, 16))}</td>
            <td>${esc(n.folio)} ${etiquetaOrigen(n) ? `<span class="origen origen--${etiquetaOrigen(n).clase}">${etiquetaOrigen(n).texto}</span>` : ''}</td>
            <td>${esc(n.cliente)}</td>
            <td>${esc(n.detalle ?? `${n.cantidad} ${n.unidad} ${n.material}`).replace(/\n/g, '<br>')}</td>
            <td>${esc(n.chofer)}${n.camion ? ` · ${esc(n.camion)}` : ''}</td>
            <td><button type="button" class="btn btn--secundario historial__devolver" data-devolver="${n.id}">↩ No se entregó</button></td>
          </tr>`).join('')
        : '<tr><td colspan="6">Todavía no hay notas en el historial.</td></tr>';
      vistas = new Map(notas.map((n) => [String(n.id), n]));
      dialogo.close();
      if (!historial.open) historial.showModal();
    } catch (err) {
      toast(err.message, true);
    }
  };
  document.addEventListener('click', (e) => { if (e.target.closest('[data-ver-historial]')) verHistorial(); });

  // "No se entregó": la nota regresa a Pendientes hoy, mañana u otro día, lista para un viaje nuevo.
  const devolver = document.querySelector('#devolver-nota');
  const fechaDevolver = document.querySelector('#devolver-fecha');
  const diaLocal = (mas) => {
    const d = new Date();
    d.setDate(d.getDate() + mas);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  historial.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-devolver]');
    const nota = btn && vistas.get(btn.dataset.devolver);
    if (!nota) return;
    document.querySelector('#devolver-resumen').innerHTML = `<div><b>${esc(nota.folio)}</b> · ${esc(nota.cliente)}</div><div>${esc(nota.detalle ?? `${nota.cantidad} ${nota.unidad} ${nota.material}`).replace(/\n/g, '<br>')}</div>`;
    fechaDevolver.min = diaLocal(2); // mañana tiene su propio botón
    fechaDevolver.value = '';
    devolver.returnValue = '';
    devolver.showModal();
    await new Promise((listo) => devolver.addEventListener('close', listo, { once: true }));
    const opcion = devolver.returnValue;
    if (!['hoy', 'manana', 'otro'].includes(opcion) || (opcion === 'otro' && !fechaDevolver.value)) return;
    const fecha = opcion === 'hoy' ? null : opcion === 'manana' ? diaLocal(1) : fechaDevolver.value;
    btn.disabled = true;
    try {
      await api.post(`/api/notas/${nota.id}/devolver`, { fecha });
      const dia = fecha && new Date(`${fecha}T12:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
      toast(opcion === 'hoy' ? `${nota.folio} regresó a Pendientes` : opcion === 'manana' ? `${nota.folio} → Reparto de mañana` : `${nota.folio} quedó para el ${dia}`);
      alCerrar();
      document.dispatchEvent(new Event('notas-programadas')); // el corcho recarga Mañana y Por Confirmar
      verHistorial();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  });
  historial.querySelector('[data-cerrar-historial]').addEventListener('click', () => historial.close());
}
