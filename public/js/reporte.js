// Página del reporte semanal: pide los números al servidor y los pinta.
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const fecha = (t) => new Date(t.replace(' ', 'T')).toLocaleString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function cargar() {
  const dia = $('#dia').value;
  const r = await fetch(`/api/reportes/semanal${dia ? `?dia=${dia}` : ''}`);
  if (r.status === 401) return location.assign('/login.html');
  const d = await r.json();
  if (!r.ok) {
    $('#periodo').textContent = d.error ?? 'No se pudo cargar';
    return;
  }
  // fin es el domingo 00:00: se muestra como "cierre del sábado".
  const sabado = new Date(`${d.fin.slice(0, 10)}T00:00`);
  sabado.setDate(sabado.getDate() - 1);
  $('#periodo').textContent = `Del ${fecha(d.inicio)} al cierre del ${sabado.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })}`;
  $('#ordenes').textContent = d.octavio.ordenes;
  $('#entradas').textContent = d.octavio.entradas;
  $('#creadas').textContent = d.chatito.creadas;
  $('#pagadas').textContent = d.chatito.pagadas;
  $('#despachados').textContent = d.edgar.despachados;
  $('#viajes').innerHTML = d.edgar.viajes.length
    ? d.edgar.viajes.map((v) => `<tr><td>${esc(v.chofer)}</td><td>${esc(v.unidad)}</td><td>${v.viajes}</td></tr>`).join('')
    : '<tr><td colspan="3">Sin entregas esta semana</td></tr>';
}

$('#dia').addEventListener('change', cargar);
$('#imprimir').addEventListener('click', () => print());
cargar();
