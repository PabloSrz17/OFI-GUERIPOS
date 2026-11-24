// Sugerencias de conceptos (lista de precios) al escribir la descripción en las cotizaciones.
// Es propia y no la del navegador, para poder borrar ahí mismo los repetidos o mal escritos (🗑).
// lista(): conceptos; alElegir(input, concepto); alBorrar(concepto) -> promesa.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const dinero = (n) => `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MAX = 60;

export function montarSugerencias({ campos, lista, alElegir, alBorrar }) {
  const caja = document.createElement('ul');
  caja.className = 'sugerencias';
  caja.setAttribute('role', 'listbox');
  caja.hidden = true;
  let input = null;
  let opciones = [];
  let activa = -1;

  const esCampo = (el) => el?.matches?.(campos) && !el.closest('.fila-flete');

  function pintar() {
    const t = input.value.trim().toUpperCase();
    opciones = lista().filter((p) => p.nombre.toUpperCase().includes(t))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }) || a.id - b.id)
      .slice(0, MAX);
    if (!opciones.length) { cerrar(); return; }
    activa = Math.min(activa, opciones.length - 1);
    caja.innerHTML = opciones.map((p, i) => `
      <li role="option" data-i="${i}" class="${i === activa ? 'activa' : ''}">
        <span class="sugerencias__nombre">${esc(p.nombre)} <small>${esc(p.unidad)} · ${dinero(p.precio)}</small></span>
        <button type="button" data-borrar="${i}" title="Borrar este concepto" aria-label="Borrar ${esc(p.nombre)}">🗑️ Borrar</button>
      </li>`).join('');
    // Dentro de la misma ventana (las ventanas van "encima de todo"), pegada abajo del campo.
    const dueno = input.closest('dialog') ?? document.body;
    if (caja.parentElement !== dueno) dueno.append(caja);
    caja.hidden = false;
    posicionar();
  }
  // Pegada abajo del campo (o arriba si no cabe). Si el campo ya no se ve, se cierra.
  function posicionar() {
    const r = input.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) { cerrar(); return; }
    const abajo = window.innerHeight - r.bottom;
    caja.style.left = `${r.left}px`;
    caja.style.width = `${Math.max(r.width, 320)}px`;
    caja.style.top = abajo > 220 ? `${r.bottom + 2}px` : '';
    caja.style.bottom = abajo > 220 ? '' : `${window.innerHeight - r.top + 2}px`;
  }
  function cerrar() { caja.hidden = true; activa = -1; }
  function elegir(i) {
    const p = opciones[i];
    if (!p || !input) return;
    input.value = p.nombre;
    alElegir(input, p);
    cerrar();
  }

  document.addEventListener('focusin', (e) => {
    if (!esCampo(e.target)) return;
    input = e.target;
    input.setAttribute('autocomplete', 'off');
    activa = -1;
    pintar();
  });
  document.addEventListener('input', (e) => { if (e.target === input) { activa = -1; pintar(); } });
  document.addEventListener('focusout', (e) => { if (e.target === input) setTimeout(() => { if (document.activeElement !== input) cerrar(); }, 150); });
  document.addEventListener('keydown', (e) => {
    if (e.target !== input || caja.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      activa = (activa + (e.key === 'ArrowDown' ? 1 : -1) + opciones.length) % opciones.length;
      pintar();
      caja.querySelector('.activa')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && activa >= 0) {
      e.preventDefault();
      elegir(activa);
    } else if (e.key === 'Escape') {
      cerrar();
    }
  });
  window.addEventListener('resize', cerrar);
  document.addEventListener('scroll', (e) => { if (!caja.hidden && !caja.contains(e.target)) posicionar(); }, true);

  // mousedown: que el campo no pierda el foco antes del clic.
  caja.addEventListener('mousedown', (e) => e.preventDefault());
  caja.addEventListener('click', async (e) => {
    const borrar = e.target.closest('[data-borrar]');
    if (!borrar) {
      const li = e.target.closest('li[data-i]');
      if (li) elegir(Number(li.dataset.i));
      return;
    }
    const p = opciones[Number(borrar.dataset.borrar)];
    if (!p || !window.confirm(`¿Borrar "${p.nombre}" (${p.unidad} · ${dinero(p.precio)}) de los conceptos guardados?`)) return;
    borrar.disabled = true;
    try {
      await alBorrar(p);
      if (input) { input.focus(); pintar(); }
    } catch {
      borrar.disabled = false;
    }
  });
}
