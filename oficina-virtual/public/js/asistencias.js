// Pizarra de asistencias: semana de lunes a sábado. Cada clic cambia la casilla: vacía → ✓ → ✕ → ⏰ → vacía.
// El retardo cuenta como día trabajado (también en "Hoy: N de M").
import { api } from './api.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const $ = (s) => document.querySelector(s);
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const SIGUIENTE = { '': 'asistio', asistio: 'falta', falta: 'retardo', retardo: null };
const SIMBOLO = { asistio: '✓', falta: '✕', retardo: '⏰' };
const TEXTO = { asistio: 'asistió', falta: 'faltó', retardo: 'retardo' };
const TRABAJO = (estado) => estado === 'asistio' || estado === 'retardo';

const fecha = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function lunesDe(d) {
  const lunes = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7)); // el domingo cuenta en la semana que termina
  return lunes;
}
const masDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

let lunes = lunesDe(new Date());

export async function recargarAsistencias() {
  const dias = DIAS.map((_, i) => fecha(masDias(lunes, i)));
  const hoy = fecha(new Date());
  let datos;
  try {
    datos = await api.get(`/api/asistencias?desde=${dias[0]}&hasta=${dias[5]}`);
  } catch { return; }
  const marca = new Map(datos.marcas.map((m) => [`${m.trabajador_id}|${m.fecha}`, m.estado]));

  $('#asistencias-semana').textContent = `${dias[0].slice(8)}/${dias[0].slice(5, 7)} al ${dias[5].slice(8)}/${dias[5].slice(5, 7)}`;
  $('#asistencias-siguiente').disabled = masDias(lunes, 7) > new Date();
  const llegaron = datos.marcas.filter((m) => m.fecha === hoy && TRABAJO(m.estado)).length;
  $('#asistencias-contador').textContent = dias.includes(hoy) ? `Hoy: ${llegaron} de ${datos.trabajadores.length}` : '';
  $('#asistencias-tabla').innerHTML = `
    <thead><tr><th>Trabajador</th>${dias.map((f, i) => `<th class="${f === hoy ? 'hoy' : ''}">${DIAS[i]} ${f.slice(8)}</th>`).join('')}<th>✓</th></tr></thead>
    <tbody>${datos.trabajadores.map((t) => {
      const celdas = dias.map((f) => {
        const estado = marca.get(`${t.id}|${f}`) ?? '';
        return `<td class="${f === hoy ? 'hoy' : ''}"><button type="button" class="asistencia" data-estado="${estado}" data-id="${t.id}" data-fecha="${f}"
          aria-label="${esc(t.nombre)}, ${f}: ${TEXTO[estado] ?? 'sin marcar'}" ${f > hoy ? 'disabled' : ''}>${SIMBOLO[estado] ?? ''}</button></td>`;
      }).join('');
      const total = dias.filter((f) => TRABAJO(marca.get(`${t.id}|${f}`))).length;
      return `<tr><th scope="row">${esc(t.nombre)}</th>${celdas}<td class="asistencias__total">${total}</td></tr>`;
    }).join('')}</tbody>`;
}

export function montarAsistencias(toast) {
  const cambiarSemana = (n) => { lunes = masDias(lunes, n); recargarAsistencias(); };
  $('#asistencias-anterior').addEventListener('click', () => cambiarSemana(-7));
  $('#asistencias-siguiente').addEventListener('click', () => cambiarSemana(7));
  $('#asistencias-tabla').addEventListener('click', async (e) => {
    const b = e.target.closest('button.asistencia');
    if (!b) return;
    b.disabled = true;
    try {
      await api.put('/api/asistencias', { trabajador_id: Number(b.dataset.id), fecha: b.dataset.fecha, estado: SIGUIENTE[b.dataset.estado] });
    } catch (err) {
      toast(err.message, true);
    }
    recargarAsistencias();
  });
  recargarAsistencias();
}
