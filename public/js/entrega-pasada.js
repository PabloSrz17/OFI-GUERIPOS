// 📅 Entrega pasada: la nota se entregó otro día (ej. ayer) y no se marcó en su momento.
// Se elige la fecha real, el viaje, el chofer y el camión; el servidor la deja entregada con esa fecha.
import { api } from './api.js';
const VIAJES = ['1er', '2do', '3er', '4to', '5to', '6to', '7mo']; // como en el corcho

const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const diaLocal = (mas) => {
  const d = new Date();
  d.setDate(d.getDate() + mas);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const opciones = (lista, actual, vacio) => `<option value="">${vacio}</option>${lista.map((o) =>
  `<option value="${o.id}" ${o.id === actual ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}`;

export function montarEntregaPasada({ notaPorId, catalogos, alGuardar, toast }) {
  const dialogo = $('#entrega-pasada');
  const fecha = $('#entrega-pasada-fecha');
  const viaje = $('#entrega-pasada-viaje');
  const chofer = $('#entrega-pasada-chofer');
  const camion = $('#entrega-pasada-camion');
  const aviso = $('#entrega-pasada-aviso');
  let nota = null;

  // Quien recoge en ALMACÉN no lleva camión.
  const esAlmacen = () => Boolean(catalogos.choferes.find((c) => String(c.id) === chofer.value)?.almacen);
  const revisarCamion = () => { camion.disabled = esAlmacen(); if (camion.disabled) camion.value = ''; };
  chofer.addEventListener('change', revisarCamion);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-accion="entrega-pasada"]');
    if (!btn) return;
    // En Por Confirmar / mañana la nota puede no estar en el tablero de hoy: se busca en el corcho.
    nota = notaPorId(btn.dataset.id) ?? { id: btn.dataset.id, folio: btn.closest('[data-id]')?.querySelector('header b')?.textContent ?? '', cliente: '' };
    $('#entrega-pasada-resumen').innerHTML = `<div><b>${esc(nota.folio)}</b>${nota.cliente ? ` · ${esc(nota.cliente)}` : ''}</div>`;
    fecha.max = diaLocal(-1);
    fecha.min = diaLocal(-60);
    fecha.value = diaLocal(-1); // lo más común: se entregó ayer
    viaje.innerHTML = VIAJES.map((v, i) => `<option value="${i + 1}" ${i + 1 === (nota.viaje || 1) ? 'selected' : ''}>${v} viaje</option>`).join('');
    chofer.innerHTML = opciones(catalogos.choferes, nota.chofer_id, '— Elige el chofer —');
    camion.innerHTML = opciones(catalogos.camiones, nota.camion_id, '— Elige el camión —');
    revisarCamion();
    aviso.hidden = true;
    dialogo.showModal();
  });

  dialogo.querySelector('form').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'guardar') return;
    e.preventDefault(); // la ventana se cierra sólo si el servidor acepta
    const falta = !fecha.value ? 'Elige la fecha' : !chofer.value ? 'Elige el chofer' : !esAlmacen() && !camion.value ? 'Elige el camión' : '';
    if (falta) { aviso.textContent = falta; aviso.hidden = false; return; }
    const boton = $('#entrega-pasada-guardar');
    boton.disabled = true;
    try {
      const r = await api.post(`/api/notas/${nota.id}/entrega-pasada`, {
        fecha: fecha.value, viaje: Number(viaje.value), chofer_id: Number(chofer.value), camion_id: camion.value ? Number(camion.value) : null,
      });
      dialogo.close();
      const [a, m, d] = fecha.value.split('-');
      toast(`📅 ${r.folio}: entregada el ${d}/${m}/${a.slice(2)}`);
      await alGuardar();
    } catch (err) {
      aviso.textContent = err.message;
      aviso.hidden = false;
    } finally {
      boton.disabled = false;
    }
  });
}
