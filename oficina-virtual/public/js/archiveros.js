// Archiveros junto a los escritorios: el de Sulema busca fotos de notas firmadas; el de Edgar enseña
// las entregas, los viajes y el combustible de un día. Se cargan al abrirse.
import { api } from './api.js';

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const pesos = (n) => `$${Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;
const hora = (t) => String(t ?? '').slice(11, 16);
const dos = (n) => String(n).padStart(2, '0');
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`; };

async function buscarEvidencias() {
  const lista = $('#archivo-sulema-lista');
  const datos = Object.fromEntries([...new FormData($('#archivo-sulema-filtros'))].filter(([, v]) => v));
  lista.innerHTML = '<p>Buscando…</p>';
  try {
    const fotos = await api.get(`/api/evidencias?${new URLSearchParams(datos)}`);
    lista.innerHTML = fotos.length
      ? fotos.map((e) => `
        <figure class="archivo__foto">
          ${e.foto
    ? `<button type="button" class="foto-mini" data-foto="${e.foto}" title="Ampliar"><img src="${e.foto}" alt="Nota ${esc(e.folio)}" loading="lazy"></button>`
    : `<div class="archivo__paquete">📦 ${esc(e.paquete)}</div>`}
          <figcaption><b>${esc(e.folio)}</b> ${esc(e.cliente)}<br>${esc(e.creado_en.slice(0, 16))}${e.envio ? ` · ${esc(e.envio)}` : ''}</figcaption>
        </figure>`).join('')
      : '<p>No hay notas firmadas con esos datos.</p>';
  } catch (err) {
    lista.innerHTML = `<p>${esc(err.message)}</p>`;
  }
}

// Encabezado "=Viajes" o ">Importe": columna centrada o a la derecha (sus celdas llevan la misma clase).
const tabla = (encabezados, filas, vacio) => (filas.length
  ? `<table class="archivo__tabla"><thead><tr>${encabezados.map((h) => (h[0] === '>' ? `<th class="n">${h.slice(1)}</th>` : h[0] === '=' ? `<th class="c">${h.slice(1)}</th>` : `<th>${h}</th>`)).join('')}</tr></thead><tbody>${filas.join('')}</tbody></table>`
  : `<p class="archivo__vacio">${vacio}</p>`);

async function cargarDia() {
  const caja = $('#archivo-edgar-contenido');
  const dia = $('#archivo-edgar-dia').value || hoy();
  caja.innerHTML = '<p>Cargando…</p>';
  try {
    const d = await api.get(`/api/reportes/dia?dia=${dia}`);
    caja.innerHTML = `
      <div class="archivo__cifras">
        <p><span>📦 Entregas</span><b>${d.entregas.length}</b></p>
        <p><span>⛽ Combustible</span><b>${pesos(d.total_combustible)}</b></p>
        <p><span>De ése, diésel</span><b>${pesos(d.diesel)}</b></p>
      </div>
      <section class="archivo__seccion">
        <h3>Fletes por chofer y unidad</h3>
        ${tabla(['Chofer', 'Unidad', '=Viajes'], d.viajes.map((v) => `<tr><td>${esc(v.chofer)}</td><td>${esc(v.unidad)}</td><td class="c">${v.viajes}</td></tr>`), 'Sin viajes este día.')}
      </section>
      <section class="archivo__seccion">
        <h3>Entregas</h3>
        ${tabla(['Hora', '=Folio', 'Cliente', 'Material', 'Chofer', 'Unidad', ''], d.entregas.map((e) => `<tr>
          <td class="suave">${hora(e.entregada_en)}</td><td class="c">${esc(e.folio)}</td><td>${esc(e.cliente)}</td>
          <td>${esc(`${e.cantidad} ${e.unidad} ${e.material}`)}</td><td class="nw">${esc(e.chofer)}</td><td class="suave nw">${esc(e.camion)}</td>
          <td class="c">${e.evidencias ? '📸' : ''}</td></tr>`), 'Sin entregas este día.')}
      </section>
      <section class="archivo__seccion">
        <h3>Combustible</h3>
        ${tabla(['Hora', 'Unidad', 'Concepto', '>Litros', '>Importe', 'Reportó'], d.combustible.map((c) => `<tr>
          <td class="suave">${hora(c.creado_en)}</td><td>${esc(c.unidad)}</td><td>${c.concepto === 'diesel' ? 'Diésel' : 'Gasolina'}</td>
          <td class="n">${c.litros ?? ''}</td><td class="n">${pesos(c.importe)}</td><td class="suave">${esc(c.reporto)}</td></tr>`), 'Sin cargas este día. Se anotan en el grupo: "Edgar, la Nissan blanca echó 500 de gas".')}
      </section>`;
  } catch (err) {
    caja.innerHTML = `<p>${esc(err.message)}</p>`;
  }
}

// Control de Gasolina de Edgar: bitácora de cargas con filtros.
async function cargarGasolina() {
  const caja = $('#gasolina-contenido');
  const filtros = Object.fromEntries([...new FormData($('#gasolina-filtros'))].filter(([, v]) => v));
  const cuantos = Object.keys(filtros).length; // con los filtros plegados, el botón dice cuántos hay puestos
  $('.gasolina__filtros summary').textContent = cuantos ? `Filtros (${cuantos}) ▾` : 'Filtros ▾';
  caja.innerHTML = '<p>Cargando…</p>';
  try {
    const d = await api.get(`/api/reportes/combustible?${new URLSearchParams(filtros)}`);
    caja.innerHTML = `
      <div class="archivo__cifras">
        <p><span>Cargas</span><b>${d.cargas.length}</b></p>
        <p><span>Total</span><b>${pesos(d.total)}</b></p>
        ${d.por_unidad.slice(0, 4).map((u) => `<p><span>${esc(u.unidad)}</span><b>${pesos(u.importe)}</b></p>`).join('')}
      </div>
      <section class="archivo__seccion">
        ${tabla(['Fecha', 'Unidad', 'Concepto', '>Litros', '>Importe', 'Reportó'], d.cargas.map((c) => `<tr title="${esc(c.mensaje)}">
          <td class="suave nw">${esc(c.creado_en.slice(0, 16))}</td><td class="nw">${esc(c.unidad)}</td><td>${c.concepto === 'diesel' ? 'Diésel' : 'Gasolina'}</td>
          <td class="n">${c.litros ?? ''}</td><td class="n">${pesos(c.importe)}</td><td class="suave">${esc(c.reporto)}</td></tr>`), 'No hay cargas con esos filtros.')}
      </section>`;
  } catch (err) {
    caja.innerHTML = `<p>${esc(err.message)}</p>`;
  }
}

// Carga anotada a mano desde la ventana.
async function anotarGasolina(e) {
  e.preventDefault();
  const form = e.target;
  const aviso = $('#gasolina-aviso');
  try {
    await api.post('/api/reportes/combustible', Object.fromEntries(new FormData(form)));
    form.reset();
    aviso.textContent = 'Enterado ✅';
    cargarGasolina();
  } catch (err) {
    aviso.textContent = err.message;
  }
}

export function montarArchiveros() {
  $('#ventana-gasolina').addEventListener('toggle', (e) => { if (e.newState === 'open') cargarGasolina(); });
  $('#gasolina-nueva').addEventListener('submit', anotarGasolina);
  $('#gasolina-filtros').addEventListener('submit', (e) => {
    e.preventDefault();
    cargarGasolina();
  });
  $('#ventana-archivo_sulema').addEventListener('toggle', (e) => { if (e.newState === 'open') buscarEvidencias(); });
  $('#archivo-sulema-filtros').addEventListener('submit', (e) => {
    e.preventDefault();
    buscarEvidencias();
  });
  const dia = $('#archivo-edgar-dia');
  $('#ventana-archivo_edgar').addEventListener('toggle', (e) => {
    if (e.newState !== 'open') return;
    dia.value ||= hoy();
    cargarDia();
  });
  dia.addEventListener('change', cargarDia);
  document.querySelectorAll('#ventana-archivo_edgar [data-dia]').forEach((b) => b.addEventListener('click', () => {
    const [a, m, n] = (dia.value || hoy()).split('-').map(Number);
    const d = new Date(a, m - 1, n + Number(b.dataset.dia));
    dia.value = `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
    cargarDia();
  }));
}
