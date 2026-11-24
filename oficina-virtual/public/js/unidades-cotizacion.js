// Unidades de las cotizaciones: sólo estas 5 (mismo mapa que cotizador.js del servidor).
// Lo viejo se traduce ("PZA", "pieza" -> pza; "m³" -> m3); lo que no tiene equivalente se ve marcado "(revisar)".
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const UNIDADES = ['pza', 'kg', 'm3', 'm2', 'ML'];
const SINONIMOS = {
  pz: 'pza', pza: 'pza', pzas: 'pza', pieza: 'pza', piezas: 'pza',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg',
  m3: 'm3', 'm³': 'm3',
  m2: 'm2', 'm²': 'm2',
  ml: 'ML', mt: 'ML', mts: 'ML', metro: 'ML', metros: 'ML',
};

export const unidadCotizacion = (u) => SINONIMOS[String(u ?? '').trim().toLowerCase()] ?? String(u ?? '').trim();

// atributo: 'data-articulo="unidad"' o 'data-campo="unidad"'
export function selectUnidad(atributo, valor) {
  const v = unidadCotizacion(valor);
  const otra = v && !UNIDADES.includes(v) ? `<option value="${esc(v)}" selected>${esc(v)} (revisar)</option>` : '';
  return `<select ${atributo}>
    <option value=""${v ? '' : ' selected'}>—</option>
    ${UNIDADES.map((u) => `<option${u === v ? ' selected' : ''}>${u}</option>`).join('')}${otra}
  </select>`;
}

// Todo lo que se escribe en la cotización va en MAYÚSCULAS (sin mover el cursor).
export function enMayusculas(e) {
  const el = e.target;
  if (el.tagName !== 'INPUT' || !['text', null].includes(el.getAttribute('type'))) return;
  const mayus = el.value.toUpperCase();
  if (mayus === el.value) return;
  const [ini, fin] = [el.selectionStart, el.selectionEnd];
  el.value = mayus;
  el.setSelectionRange(ini, fin);
}
