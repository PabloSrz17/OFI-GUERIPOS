// Página del reporte semanal: pide los números al servidor y los pinta.
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const pesos = (n) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const litros = (n) => `${(Math.round(n * 10) / 10).toLocaleString('es-MX')} L`;
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
  pintarOctavio(d.octavio);
  $('#creadas').textContent = d.chatito.creadas;
  $('#pagadas').textContent = d.chatito.pagadas;
  $('#despachados').textContent = d.edgar.despachados;
  pintarViajes(d.edgar.viajes);
  pintarEntregas(d.edgar);
  pintarCombustible(d.edgar.combustible);
}

const ESTADOS = { por_aprobar: '⏳ Por aprobar', aprobada: '✅ Aprobada', surtida: '📦 Surtida', cancelada: '✖ Cancelada' };
const materiales = (renglones) => (renglones.length
  ? `<ul>${renglones.map((r) => `<li><span class="cant">${esc(r.cantidad ?? '')} ${esc(r.unidad ?? '')}</span> ${esc(r.material ?? '')}</li>`).join('')}</ul>`
  : '–');

function pintarOctavio(o) {
  $('#lista-ordenes').innerHTML = o.lista_ordenes.length
    ? o.lista_ordenes.map((x) => `<tr><td class="fecha">${esc(fecha(x.creado_en))}</td><td>${esc(x.solicitante)}</td><td>${esc(x.sucursal)}</td><td>${materiales(x.renglones)}</td><td class="estado">${ESTADOS[x.estado] ?? esc(x.estado)}</td></tr>`).join('')
    : '<tr><td colspan="5">Sin órdenes esta semana</td></tr>';
  $('#lista-entradas').innerHTML = o.lista_entradas.length
    ? o.lista_entradas.map((x) => `<tr><td class="fecha">${esc(fecha(x.creado_en))}</td><td>${esc(x.proveedor || '–')}</td><td>${esc(x.folio || 'Sin folio')}</td><td>${materiales(x.renglones)}${x.nota ? `<small>📝 ${esc(x.nota)}</small>` : ''}</td></tr>`).join('')
    : '<tr><td colspan="4">Sin entradas esta semana</td></tr>';
}

// Una fila por chofer, una columna por unidad, y el total de cada uno.
function pintarViajes(lista) {
  if (!lista.length) {
    $('#viajes').innerHTML = '<tbody><tr><td>Sin entregas esta semana</td></tr></tbody>';
    return;
  }
  const total = (filtro) => lista.filter(filtro).reduce((s, v) => s + v.viajes, 0);
  const unidades = [...new Set(lista.map((v) => v.unidad))].sort((a, b) => total((v) => v.unidad === b) - total((v) => v.unidad === a));
  const choferes = [...new Set(lista.map((v) => v.chofer))].sort((a, b) => total((v) => v.chofer === b) - total((v) => v.chofer === a));
  const celda = (n) => `<td class="num${n ? '' : ' vacio'}">${n || '–'}</td>`;
  $('#viajes').innerHTML = `
    <thead><tr><th>Chofer</th>${unidades.map((u) => `<th class="num">${esc(u)}</th>`).join('')}<th class="num">Total</th></tr></thead>
    <tbody>${choferes.map((c) => `<tr><td>${esc(c)}</td>${unidades.map((u) => celda(total((v) => v.chofer === c && v.unidad === u))).join('')}<td class="num total">${total((v) => v.chofer === c)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total</td>${unidades.map((u) => celda(total((v) => v.unidad === u))).join('')}<td class="num">${total(() => true)}</td></tr></tfoot>`;
}

// Cada nota entregada, agrupada por chofer, con sus viajes y notas en el encabezado.
function pintarEntregas({ entregas, viajes }) {
  if (!entregas.length) {
    $('#lista-entregas').innerHTML = '<tr><td colspan="5">Sin entregas esta semana</td></tr>';
    return;
  }
  const choferes = [...new Set(entregas.map((e) => e.chofer))];
  const viajesDe = (c) => viajes.filter((v) => v.chofer === c).reduce((s, v) => s + v.viajes, 0);
  const material = (e) => materiales(e.detalle
    ? e.detalle.split('\n').filter((l) => l.trim() && !l.startsWith('⚠️')).map((l) => ({ material: l }))
    : [{ cantidad: e.cantidad, unidad: e.unidad, material: e.material }]);
  $('#lista-entregas').innerHTML = choferes.map((c) => {
    const suyas = entregas.filter((e) => e.chofer === c);
    return `<tr class="grupo"><td colspan="5">👷 ${esc(c)} · ${viajesDe(c)} ${viajesDe(c) === 1 ? 'viaje' : 'viajes'} · ${suyas.length} ${suyas.length === 1 ? 'nota' : 'notas'}</td></tr>`
      + suyas.map((e) => `<tr><td class="fecha">${esc(fecha(e.entregada_en))}</td><td>${esc(e.folio)}</td><td>${esc(e.cliente)}</td><td>${material(e)}</td><td>${esc(e.camion)}</td></tr>`).join('');
  }).join('');
}

function pintarCombustible(g) {
  $('#gas-importe').textContent = pesos(g.importe);
  $('#gas-litros').textContent = litros(g.litros);
  $('#gas-cargas').textContent = g.cargas.length;
  $('#gas-sin-litros').hidden = !g.sin_litros;
  $('#gas-sin-litros').textContent = `⚠ ${g.sin_litros} ${g.sin_litros === 1 ? 'carga no trae' : 'cargas no traen'} litros: no entran en el total de litros.`;
  $('#gas-unidades').innerHTML = g.por_unidad.length
    ? g.por_unidad.map((u) => `<tr><td>${esc(u.unidad)}</td><td class="num">${u.cargas}</td><td class="num">${u.litros ? litros(u.litros) : '–'}</td><td class="num">${pesos(u.importe)}</td></tr>`).join('')
      + `<tr class="total"><td>Total</td><td class="num">${g.cargas.length}</td><td class="num">${litros(g.litros)}</td><td class="num">${pesos(g.importe)}</td></tr>`
    : '<tr><td colspan="4">Sin cargas esta semana</td></tr>';
  $('#gas-cargas-lista').innerHTML = g.cargas.length
    ? g.cargas.map((c) => `<tr><td>${esc(fecha(c.creado_en))}</td><td>${esc(c.unidad)}</td><td>${c.concepto === 'diesel' ? 'Diésel' : 'Gasolina'}</td><td class="num">${c.litros ? litros(c.litros) : '–'}</td><td class="num">${pesos(c.importe)}</td><td>${esc(c.reporto ?? '–')}</td></tr>`).join('')
    : '<tr><td colspan="6">Sin cargas esta semana</td></tr>';
}

$('#dia').addEventListener('change', cargar);
$('#imprimir').addEventListener('click', () => print());
cargar();
