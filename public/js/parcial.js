// Ventana ✂ Envío parcial: qué va en este viaje. Lo demás pasa a Saldos Pendientes.
import { api } from './api.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const fila = (r, i) => `
  <div class="parcial__fila">
    <span>${esc(r.texto)}${r.enSaldo ? `<small class="parcial__saldo">En saldo: ${r.enSaldo} · Máximo: ${r.maximo}</small>` : ''}</span>
    ${r.cantidad === null
    ? `<label class="parcial__va"><input type="checkbox" data-renglon="${i}" ${r.va ? 'checked' : ''}> Va</label>`
    : `<label class="campo">Enviar <input data-renglon="${i}" value="${esc(r.va ? r.cantidad : '0')}" inputmode="decimal" autocomplete="off"></label>`}
  </div>`;

// "272-S1: quedan 182 PZA BOVEDILLA" | "272-S1: quedan 5 m³ POLVO, 20 pz BLOCK"
const queda = (s) => (s.detalle
  ? s.detalle.split('\n').filter((l) => !l.startsWith('⚠️')).join(', ')
  : [s.cantidad, s.unidad, s.material].filter(Boolean).join(' '));

export function montarParcial({ notaPorId, alGuardar, toast }) {
  const dialogo = document.querySelector('#envio-parcial');
  const form = dialogo.querySelector('form');
  const filas = dialogo.querySelector('#parcial-renglones');
  const aviso = dialogo.querySelector('#parcial-aviso');
  let nota = null;

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-accion="parcial"]');
    if (e.target.closest('#envio-parcial [data-cerrar]')) dialogo.close();
    if (!btn) return;
    nota = notaPorId(btn.dataset.id);
    try {
      const renglones = await api.get(`/api/notas/${nota.id}/renglones`);
      dialogo.querySelector('#parcial-resumen').innerHTML = `<div><b>${esc(nota.folio)}</b> · ${esc(nota.cliente)}</div>`;
      filas.innerHTML = renglones.map(fila).join('');
      aviso.textContent = '';
      dialogo.showModal();
      filas.querySelector('input')?.select();
    } catch (err) {
      toast(err.message, true);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const enviar = [...filas.querySelectorAll('[data-renglon]')]
      .map((c) => (c.type === 'checkbox' ? (c.checked ? '1' : '0') : c.value));
    try {
      const { saldo } = await api.post(`/api/notas/${nota.id}/parcial`, { enviar });
      dialogo.close();
      toast(saldo ? `Saldo ${saldo.folio}: quedan ${queda(saldo)}` : `${nota.folio}: el viaje lleva todo, ya no queda saldo`);
      await alGuardar();
    } catch (err) {
      aviso.textContent = err.message; // sigue abierta para corregir
    }
  });
}
