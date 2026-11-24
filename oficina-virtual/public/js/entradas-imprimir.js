// Hoja de entradas de almacén para imprimir o guardar como PDF (el diálogo de impresión del navegador
// trae "Guardar como PDF"). /entradas.html?desde=AAAA-MM-DD&hasta=AAAA-MM-DD&imprimir=1
import { api } from './api.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const $ = (s) => document.querySelector(s);
const linea = (r) => [r.cantidad, r.unidad, r.material].filter(Boolean).join(' ');
const fecha = (iso) => iso.slice(0, 10).split('-').reverse().join('/');
const dia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const RENGLONES_VACIOS = 5; // para anotar a mano, como en la libreta

const params = new URLSearchParams(location.search);
const hoy = new Date();
const lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - ((hoy.getDay() + 6) % 7));
$('#desde').value = params.get('desde') || dia(lunes);
$('#hasta').value = params.get('hasta') || dia(hoy);

async function cargar() {
  const desde = $('#desde').value;
  const hasta = $('#hasta').value;
  $('#periodo').textContent = 'Cargando…';
  try {
    const lista = await api.get(`/api/octavio/entradas/rango?desde=${desde}&hasta=${hasta}`);
    $('#periodo').textContent = `Del ${fecha(desde)} al ${fecha(hasta)} · ${lista.length} entrada(s)`;
    $('#filas').innerHTML = lista.map((e) => `
      <tr>
        <td>${fecha(e.creado_en)}</td>
        <td>${esc(e.folio ?? '')}</td>
        <td>${esc(e.proveedor ?? '')}</td>
        <td><ul>${e.renglones.map((r) => `<li>${esc(linea(r))}</li>`).join('')}</ul></td>
      </tr>`).join('') + '<tr class="vacio"><td></td><td></td><td></td><td></td></tr>'.repeat(RENGLONES_VACIOS);
    return true;
  } catch (err) {
    $('#periodo').textContent = err.message;
    return false;
  }
}

$('#ver').addEventListener('click', cargar);
$('#imprimir').addEventListener('click', () => window.print());
if ((await cargar()) && params.get('imprimir')) window.print();
