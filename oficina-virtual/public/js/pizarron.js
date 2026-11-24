// Pizarrón de la Oficina: pendientes del equipo humano. Se recarga solo cuando otro equipo
// lo cambia (evento "pizarron" de /api/eventos).
import { api } from './api.js';
import { ponerCuenta } from './oficina.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const $ = (s) => document.querySelector(s);
const CLAVE_AUTOR = 'pizarron-autor';

function nota(n) {
  const hecho = n.estado === 'completado';
  const hora = (hecho ? n.completado_en : n.creado_en).slice(11, 16);
  return `
    <li class="pizarron__nota" data-id="${n.id}" data-estado="${n.estado}">
      <label>
        <input type="checkbox" data-accion="marcar" ${hecho ? 'checked' : ''}>
        <span class="pizarron__texto">${esc(n.texto)}</span>
      </label>
      <span class="pizarron__meta">${n.creado_por ? `${esc(n.creado_por)} · ` : ''}${hecho ? '✔ ' : ''}${hora}</span>
      <button type="button" class="pizarron__borrar" data-accion="borrar" aria-label="Borrar nota">×</button>
    </li>`;
}

export async function recargarPizarron() {
  try {
    const notas = await api.get('/api/pizarron');
    const pendientes = notas.filter((n) => n.estado === 'pendiente').length;
    ponerCuenta('dia', pendientes);
    $('#pizarron-contador').textContent = pendientes ? `${pendientes} pendiente${pendientes === 1 ? '' : 's'}` : 'Todo al día ✔';
    $('#pizarron-lista').innerHTML = notas.length
      ? notas.map(nota).join('')
      : '<li class="pizarron__vacio">Sin pendientes. Anota lo que el equipo no debe olvidar.</li>';
  } catch { /* se reintenta en el siguiente aviso */ }
}

export function montarPizarron(toast) {
  const autor = $('#pizarron-autor');
  try { autor.value = localStorage.getItem(CLAVE_AUTOR) ?? ''; } catch { /* sin almacenamiento */ }

  $('#form-pizarron').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      try { localStorage.setItem(CLAVE_AUTOR, autor.value.trim()); } catch { /* sin almacenamiento */ }
      await api.post('/api/pizarron', { texto: $('#pizarron-texto').value, creado_por: autor.value });
      $('#pizarron-texto').value = '';
      recargarPizarron();
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#pizarron-lista').addEventListener('change', async (e) => {
    if (e.target.dataset.accion !== 'marcar') return;
    const id = e.target.closest('[data-id]').dataset.id;
    await api.patch(`/api/pizarron/${id}`, { estado: e.target.checked ? 'completado' : 'pendiente' }).catch((err) => toast(err.message, true));
    recargarPizarron();
  });

  // Borrar pide dos clics: el primero arma el botón ("¿Borrar?", rojo) y se desarma solo a los 3 s.
  $('#pizarron-lista').addEventListener('click', async (e) => {
    const boton = e.target.closest('[data-accion="borrar"]');
    if (!boton) return;
    if (!boton.classList.contains('armado')) {
      boton.classList.add('armado');
      boton.textContent = '¿Borrar?';
      boton.setAttribute('aria-label', 'Clic otra vez para borrar');
      clearTimeout(boton.t);
      boton.t = setTimeout(() => {
        boton.classList.remove('armado');
        boton.textContent = '×';
        boton.setAttribute('aria-label', 'Borrar nota');
      }, 3000);
      return;
    }
    clearTimeout(boton.t);
    const li = boton.closest('[data-id]');
    li.classList.add('borrando');
    await fetch(`/api/pizarron/${li.dataset.id}`, { method: 'DELETE' }).catch(() => toast('No se pudo borrar', true));
    setTimeout(recargarPizarron, 250); // deja ver la animación de salida
  });

  recargarPizarron();
}
