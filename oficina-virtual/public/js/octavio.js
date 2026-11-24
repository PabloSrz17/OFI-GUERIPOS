// Max: alerta flotante con la orden que llegó por WhatsApp, su pizarrón de órdenes de compra
// y el registro de entradas de almacén. Las cantidades se editan antes de aprobar y después.
import { api } from './api.js';
import { formatear } from './telefono.js';
import { miniaturaFoto } from './visor-foto.js';
import { filaArticulo } from './captura.js';
import { aNumero } from './inspector.js';
import { actualizarPantalla } from './escena3d.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const $ = (sel) => document.querySelector(sel);
const linea = (r) => [r.cantidad, r.unidad, r.material].filter(Boolean).join(' ');
const ESTADO_WHATSAPP = {
  enviado: '💬 Enviada por WhatsApp',
  sin_telefono: '⚠️ Sin teléfono: no se envió',
  desconectado: '⚠️ WhatsApp sin conexión: no se envió',
  no_whatsapp: '⚠️ Ese número no tiene WhatsApp',
  error: '⚠️ No se pudo enviar',
};
const ESTATUS = { aprobada: 'Aprobada', surtida: 'Surtida', cancelada: 'Cancelada' };
const MAX_ENTRADAS = 50; // las que devuelve el servidor
// A dónde se puede mover una orden desde cada columna.
const MOVER = {
  aprobada: [['surtida', 'Surtida →'], ['cancelada', 'Cancelar ✕']],
  surtida: [['aprobada', '← Aprobadas'], ['cancelada', 'Cancelar ✕']],
  cancelada: [['aprobada', '← Aprobadas'], ['surtida', 'Surtida →']],
};

const todasLasFilas = (caja) => [...caja.querySelectorAll('.fila-articulo')].map((f) => ({
  cantidad: f.querySelector('[data-articulo="cantidad"]').value.trim(),
  unidad: f.querySelector('[data-articulo="unidad"]').value.trim(),
  material: f.querySelector('[data-articulo="material"]').value.trim().toUpperCase(),
}));
const leerFilas = (caja) => todasLasFilas(caja).filter((r) => r.material);

// Mismas reglas que el servidor (ordenes.js): lo que decide qué mensaje sale.
const claveDe = (r) => `${aNumero(r.cantidad)}|${String(r.unidad ?? '').toLowerCase()}|${String(r.material ?? '').toUpperCase()}`;
const iguales = (a, b) => JSON.stringify(a.map(claveDe)) === JSON.stringify(b.map(claveDe));

// Lo llama app.js cuando el servidor avisa que cambió algo de Max.
export let recargarOctavio = () => {};

export function montarOctavio({ toast, alCambiar }) {
  const alerta = $('#alerta-orden');
  const filas = $('#orden-articulos');
  const espera = $('#ordenes-espera');
  const dialogo = $('#editar-orden');
  const formEditar = dialogo.querySelector('form');
  const filasEditar = $('#editar-orden-articulos');
  let ordenes = [];
  let actual = null;      // la que está en la alerta
  let tocada = false;     // ya le movieron: que no se le borre si llega otro mensaje
  let oculta = new Set(); // "ver después", hasta que llegue algo nuevo de esa orden
  let enviando = false;
  let registrando = false;
  let entradas = [];
  const filasEntrada = $('#entrada-articulos');
  filasEntrada.innerHTML = filaArticulo();
  const filasNueva = $('#orden-nueva-articulos');
  filasNueva.innerHTML = filaArticulo();
  let creando = false;
  const dialogoEntrada = $('#editar-entrada');
  const formEditarEntrada = dialogoEntrada.querySelector('form');
  const filasEditarEntrada = $('#editar-entrada-articulos');

  const porAprobar = () => ordenes.filter((o) => o.estado === 'por_aprobar').sort((a, b) => a.id - b.id);
  // Por contenido: actualizado_en sólo tiene segundos y aviso y lista pueden llegar en el mismo.
  const huella = (o) => `${o.id}|${JSON.stringify([o.mensaje, o.foto, o.original])}`;
  const pintarTitulo = (orden, pendientes) => {
    $('#orden-titulo').textContent = `📥 Orden de compra ${orden.folio}${pendientes > 1 ? ` (1 de ${pendientes})` : ''}`;
  };

  function pintarPista() {
    if (!actual) return;
    const sinCambios = iguales(actual.original, leerFilas(filas));
    $('#orden-pista').textContent = sinCambios
      ? 'Sin cambios: al aprobar le llega la imagen de su orden.'
      : 'Con cambios: al aprobar le llega "Me autorizaron estas cantidades:" con la lista.';
    $('#orden-aprobar').textContent = sinCambios ? 'Aprobar y enviar imagen 💬' : 'Aprobar con estos cambios 💬';
  }

  function pintarAlerta(orden, pendientes) {
    actual = orden;
    tocada = false;
    pintarTitulo(orden, pendientes);
    $('#orden-actualizado').hidden = true;
    const c = $('#form-orden').elements;
    c.solicitante.value = orden.solicitante;
    c.telefono.value = orden.telefono ? formatear(orden.telefono) : '';
    c.sucursal.value = orden.sucursal;
    $('#orden-origen').innerHTML = `${miniaturaFoto(orden.foto)}<p>${esc(orden.mensaje) || 'Sin texto.'}</p>`;
    filas.innerHTML = (orden.renglones.length ? orden.renglones : [{}]).map(filaArticulo).join('');
    $('#orden-sin-lista').hidden = orden.renglones.length > 0;
    pintarPista();
  }

  function mostrarAlerta() {
    const lista = porAprobar();
    const visibles = lista.filter((o) => !oculta.has(huella(o)));
    const sigue = actual && lista.find((o) => o.id === actual.id);
    if (sigue && !alerta.hidden && !oculta.has(huella(sigue))) {
      pintarTitulo(sigue, lista.length);
      if (huella(sigue) === huella(actual)) return;
      if (tocada) {
        $('#orden-actualizado').hidden = false; // llegó más; lo escrito no se pierde hasta que lo pidan
        return;
      }
      pintarAlerta(sigue, lista.length);
      return;
    }
    actual = null;
    alerta.hidden = !visibles.length;
    if (visibles.length) pintarAlerta(visibles[0], lista.length);
  }

  function pintarEspera() {
    const lista = porAprobar();
    espera.hidden = !lista.length;
    $('#ordenes-espera-n').textContent = lista.length;
    $('#ordenes-espera-lista').innerHTML = lista.map((o) => `
      <li><b>${esc(o.folio)}</b> ${esc(o.solicitante)}
        <button type="button" class="btn btn--secundario" data-revisar="${o.id}">Revisar</button></li>`).join('');
  }

  // Lo que ya llegó y lo que falta, sólo cuando hubo entrega parcial.
  const conFalta = (a, o) => {
    if (!a || !o.avance.some((x) => x.recibido > 0)) return '';
    if (a.pendiente <= 0) return ' <span class="orden__llego">✓ llegó</span>';
    return ` <span class="orden__falta">· ${a.recibido > 0 ? `llegaron ${esc(a.recibido)}, ` : ''}faltan ${esc(a.pendiente)}</span>`;
  };
  function tarjeta(o) {
    const sinEnviar = o.estado === 'aprobada' && o.whatsapp !== 'enviado' && o.telefono; // las capturadas aquí no tienen a quién
    const recibir = esAlmacen(o) && o.estado === 'aprobada' ? `
        <div class="orden__botones orden__recibir">
          <button type="button" class="btn btn--ruta" data-recibir-orden="${o.id}" data-modo="todo">✅ Entregada</button>
          <button type="button" class="btn" data-recibir-orden="${o.id}" data-modo="parcial">📦 Entregada parcialmente</button>
        </div>` : '';
    const plegada = estaPlegada(o);
    return `
      <article class="orden orden--${esc(o.estado)}${plegada ? ' orden--plegada' : ''}">
        <button type="button" class="orden__cabeza" data-plegar-orden="${o.id}" aria-expanded="${!plegada}" title="${plegada ? 'Ver la orden' : 'Minimizar'}">
          <span class="orden__flecha" aria-hidden="true">${plegada ? '▸' : '▾'}</span>
          <b class="orden__folio">${esc(o.folio)}</b>
          <span class="orden__quien">${esc(o.proveedor ?? o.solicitante)}</span>
          <span class="orden__fecha">${esc((o.aprobada_en ?? o.creado_en).slice(0, 16))}</span>
          <span class="orden__estado orden__estado--${esc(o.estado)}">${esc(ESTATUS[o.estado])}</span>
        </button>
        <div class="orden__cuerpo"${plegada ? ' hidden' : ''}>
        <p class="orden__de">${esc(o.solicitante)} · ${esc(o.sucursal)}</p>
        <ul>${o.renglones.map((r, i) => `<li>${esc(linea(r))}${conFalta(o.avance?.[i], o)}</li>`).join('')}</ul>
        ${recibir}
        ${o.nota ? `<p class="orden__nota">📝 ${esc(o.nota)}</p>` : ''}
        ${o.whatsapp ? `<p class="orden__whatsapp">${esc(ESTADO_WHATSAPP[o.whatsapp] ?? o.whatsapp)}</p>` : ''}
        <div class="orden__botones orden__mover">
          ${MOVER[o.estado].map(([estado, texto]) => `<button type="button" class="btn" data-mover-orden="${o.id}" data-a="${estado}">${texto}</button>`).join('')}
        </div>
        <div class="orden__botones">
          <button type="button" class="btn btn--secundario" data-editar-orden="${o.id}">✎ Editar</button>
          <a class="btn btn--secundario" href="/api/octavio/ordenes/${o.id}/imagen" target="_blank" rel="noopener">🖼 Imagen</a>
          ${sinEnviar ? `<button type="button" class="btn" data-reenviar="${o.id}">Reenviar 💬</button>` : ''}
          ${o.estado === 'cancelada' ? `<button type="button" class="btn btn--peligro" data-eliminar-orden="${o.id}">🗑 Eliminar</button>` : ''}
        </div>
        </div>
      </article>`;
  }

  // Tarjetas que se minimizan con clic en la cabeza. Las Surtidas salen minimizadas; si alguien la abre,
  // se queda abierta hasta que la orden cambie de columna. Sólo en esta pantalla (no se guarda).
  const plegadas = new Map(); // id -> true/false que eligió el usuario
  const estadoVisto = new Map(); // id -> estatus con que se pintó la última vez
  const estaPlegada = (o) => plegadas.get(o.id) ?? o.estado === 'surtida';
  function notarCambios() {
    for (const o of ordenes) {
      if (estadoVisto.has(o.id) && estadoVisto.get(o.id) !== o.estado) plegadas.delete(o.id); // pasó a Surtida: se minimiza sola
      estadoVisto.set(o.id, o.estado);
    }
  }

  // Dos tableros iguales: las de la sucursal (Concordia, por WhatsApp) y las de Almacén (capturadas aquí
  // o cambiadas a sucursal "Almacén" al editar).
  const esAlmacen = (o) => /^almac[eé]n$/i.test(String(o.sucursal ?? '').trim());
  function pintarPizarron() {
    notarCambios();
    for (const [tablero, contador, filtro] of [['#pizarron-ordenes', '#pestana-ordenes-n', (o) => !esAlmacen(o)], ['#pizarron-almacen', '#pestana-almacen-n', esAlmacen]]) {
      const suyas = ordenes.filter((o) => o.estado in ESTATUS && filtro(o));
      for (const estado of ['aprobada', 'surtida', 'cancelada']) {
        const lista = suyas.filter((o) => o.estado === estado);
        const col = document.querySelector(`${tablero} [data-orden-estado="${estado}"]`);
        col.querySelector('.contador').textContent = lista.length;
        col.querySelector('.ordenes__lista').innerHTML = lista.map(tarjeta).join('') || '<p class="ordenes__vacio">Sin órdenes</p>';
      }
      $(contador).textContent = suyas.length;
    }
  }

  function tarjetaEntrada(e) {
    return `
      <article class="tarjeta-entrada">
        <span class="tarjeta-entrada__tipo">📦 ENTRADA</span>
        <p class="tarjeta-entrada__folio">${esc(e.folio ?? 'Sin folio')}</p>
        <p class="tarjeta-entrada__proveedor">${esc(e.proveedor ?? 'Sin proveedor')}</p>
        <ul>${e.renglones.map((r) => `<li>${esc(linea(r))}</li>`).join('')}</ul>
        <p class="tarjeta-entrada__pie">${esc(e.creado_en.slice(0, 16))}${e.nota ? ` · ${esc(e.nota)}` : ''}</p>
        <div class="orden__botones"><button type="button" class="btn btn--secundario" data-editar-entrada="${e.id}">✎ Editar</button></div>
      </article>`;
  }

  // Semanas de lunes a sábado. El domingo no se trabaja: lo que se capture ese día va con la semana que acaba.
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const isoDia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function lunesDe(fecha) {
    const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // domingo (0) retrocede 6: semana que acaba
    return d;
  }
  function tituloSemana(lunes) {
    const sabado = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 5);
    const ini = lunes.getMonth() === sabado.getMonth() ? `${lunes.getDate()}` : `${lunes.getDate()} de ${MESES[lunes.getMonth()]}`;
    const anio = lunes.getFullYear() === sabado.getFullYear() ? '' : ` de ${lunes.getFullYear()}`;
    return { sabado, texto: `Semana del ${ini}${anio} al ${sabado.getDate()} de ${MESES[sabado.getMonth()]} de ${sabado.getFullYear()}` };
  }
  // Qué semanas están abiertas: se respeta lo que el usuario abrió o cerró entre recargas.
  const semanasAbiertas = new Map();

  function pintarTableroEntradas() {
    const aviso = entradas.length >= MAX_ENTRADAS ? `<p class="tablero-entradas__aviso">Se muestran las ${MAX_ENTRADAS} más recientes.</p>` : '';
    $('#pestana-entradas-n').textContent = entradas.length;
    const semanas = new Map(); // lunes ISO -> entradas, de la más nueva a la más vieja
    for (const e of entradas) {
      const [a, m, d] = e.creado_en.slice(0, 10).split('-').map(Number);
      const clave = isoDia(lunesDe(new Date(a, m - 1, d)));
      semanas.set(clave, [...(semanas.get(clave) ?? []), e]);
    }
    const actual = isoDia(lunesDe(new Date()));
    const orden = [...semanas.keys()].sort().reverse();
    // La semana actual abre sola; si no tiene entradas, abre la más reciente.
    const porDefecto = semanas.has(actual) ? actual : orden[0];
    const bloques = orden.map((clave) => {
      const lista = semanas.get(clave);
      const [a, m, d] = clave.split('-').map(Number);
      const { sabado, texto } = tituloSemana(new Date(a, m - 1, d));
      const abierta = semanasAbiertas.get(clave) ?? clave === porDefecto;
      return `
        <details class="semana-entradas" data-semana="${clave}"${abierta ? ' open' : ''}>
          <summary class="semana-entradas__cabeza">
            <span class="semana-entradas__flecha" aria-hidden="true">▸</span>
            <span class="semana-entradas__titulo">${texto}${clave === actual ? ' <span class="semana-entradas__hoy">ESTA SEMANA</span>' : ''}</span>
            <span class="semana-entradas__n">${lista.length} ${lista.length === 1 ? 'entrada' : 'entradas'}</span>
          </summary>
          <div class="semana-entradas__tarjetas">${lista.map(tarjetaEntrada).join('')}</div>
          <a class="semana-entradas__imprimir" href="/entradas.html?desde=${clave}&hasta=${isoDia(new Date(sabado.getFullYear(), sabado.getMonth(), sabado.getDate() + 1))}" target="_blank" rel="noopener">🖨 Imprimir esta semana</a>
        </details>`;
    });
    $('#pizarron-entradas').innerHTML = aviso + (bloques.join('') || '<p class="ordenes__vacio">Sin entradas todavía.</p>');
  }
  $('#pizarron-entradas').addEventListener('toggle', (e) => {
    if (e.target.matches('.semana-entradas')) semanasAbiertas.set(e.target.dataset.semana, e.target.open);
  }, true);

  async function recargar() {
    try {
      const [lista, ultimas] = await Promise.all([api.get('/api/octavio/ordenes'), api.get('/api/octavio/entradas')]);
      ordenes = lista;
      entradas = ultimas;
      mostrarAlerta();
      pintarEspera();
      pintarPizarron();
      pintarTableroEntradas();
      // Pantalla del muro: lo que falta atender y, si queda lugar, las últimas entradas.
      actualizarPantalla('ordenes', [
        ...porAprobar().map((o) => ({ texto: `${o.folio} por aprobar`, color: '#ff6b5e' })),
        ...ordenes.filter((o) => o.estado === 'aprobada').slice(0, 3).map((o) => ({ texto: `${o.folio} ${o.sucursal}`, color: '#6fb2ff' })),
        ...entradas.map((e) => ({ texto: `Entrada ${e.folio ?? 'sin folio'}`, color: '#f97316' })),
      ]);
      $('#entradas-lista').innerHTML = entradas.map((e) => `
        <li>
          <div class="entrada__cabeza"><b>${esc(e.folio ?? 'Sin folio')}</b><span>${esc(e.proveedor ?? 'Sin proveedor')}</span></div>
          <ul class="entrada__materiales">${e.renglones.map((r) => `<li>${esc(linea(r))}</li>`).join('')}</ul>
          <span class="entrada__pie">${esc(e.creado_en.slice(0, 16))}${e.nota ? ` · ${esc(e.nota)}` : ''}</span>
          <div class="orden__botones"><button type="button" class="btn btn--secundario" data-editar-entrada="${e.id}">✎ Editar</button></div>
        </li>`).join('') || '<li>Sin entradas todavía.</li>';
    } catch (err) {
      toast(err.message, true);
    }
  }
  recargarOctavio = recargar;

  // ---- Alerta ----
  alerta.addEventListener('input', () => { tocada = true; pintarPista(); });
  alerta.addEventListener('click', (e) => {
    if (e.target.closest('[data-agregar]')) {
      filas.insertAdjacentHTML('beforeend', filaArticulo());
      filas.lastElementChild.querySelector('input').focus();
      tocada = true;
    }
    if (e.target.closest('[data-quitar]')) {
      e.target.closest('.fila-articulo').remove();
      if (!filas.children.length) filas.innerHTML = filaArticulo();
      tocada = true;
      pintarPista();
    }
    if (e.target.closest('[data-ver-despues]')) {
      oculta.add(huella(actual));
      actual = null;
      mostrarAlerta();
    }
    if (e.target.closest('[data-recargar-orden]')) {
      const sigue = porAprobar().find((o) => o.id === actual.id);
      if (sigue) pintarAlerta(sigue, porAprobar().length);
    }
  });

  $('#form-orden').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (enviando) return;
    enviando = true;
    const boton = $('#orden-aprobar');
    boton.disabled = true;
    const c = e.target.elements;
    const id = actual.id;
    try {
      const r = await api.post(`/api/octavio/ordenes/${id}/aprobar`, {
        solicitante: c.solicitante.value, telefono: c.telefono.value, sucursal: c.sucursal.value, renglones: leerFilas(filas),
      });
      toast(r.whatsapp === 'enviado' ? `${r.orden.folio} aprobada y enviada por WhatsApp` : `${r.orden.folio} aprobada. ${ESTADO_WHATSAPP[r.whatsapp]}`, r.whatsapp !== 'enviado');
      actual = null;
      alerta.hidden = true;
      await recargar();
      alCambiar();
    } catch (err) {
      toast(err.message, true); // se queda abierta con lo escrito
    } finally {
      enviando = false;
      boton.disabled = false;
    }
  });

  $('#orden-descartar').addEventListener('click', async () => {
    try {
      await api.post(`/api/octavio/ordenes/${actual.id}/descartar`, {});
      toast(`${actual.folio} descartada: no se le contestó nada`);
      actual = null;
      alerta.hidden = true;
      await recargar();
      alCambiar();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---- Panel de Max ----
  espera.addEventListener('click', (e) => {
    const boton = e.target.closest('[data-revisar]');
    if (!boton) return;
    const orden = ordenes.find((o) => o.id === Number(boton.dataset.revisar));
    oculta = new Set([...oculta].filter((k) => !k.startsWith(`${orden.id}|`)));
    alerta.hidden = false;
    pintarAlerta(orden, porAprobar().length);
  });

  // ---- Orden de compra capturada aquí (sin folio) ----
  $('#form-orden-nueva').addEventListener('click', (e) => {
    if (e.target.closest('[data-agregar]')) {
      filasNueva.insertAdjacentHTML('beforeend', filaArticulo());
      filasNueva.lastElementChild.querySelector('input').focus();
    }
    if (e.target.closest('[data-quitar]')) {
      e.target.closest('.fila-articulo').remove();
      if (!filasNueva.children.length) filasNueva.innerHTML = filaArticulo();
    }
  });
  $('#form-orden-nueva').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (creando) return;
    creando = true;
    const form = e.target;
    try {
      const orden = await api.post('/api/octavio/ordenes', {
        solicitante: form.elements.sucursal.value, sucursal: form.elements.sucursal.value, nota: form.elements.nota.value, renglones: leerFilas(filasNueva),
      });
      toast(`${orden.folio} creada en ${esAlmacen(orden) ? 'Órdenes de Compra Almacén' : 'Órdenes de Concordia'}`);
      form.reset();
      filasNueva.innerHTML = filaArticulo();
      await recargar();
    } catch (err) {
      toast(err.message, true); // lo escrito se queda para corregirlo
    } finally {
      creando = false;
    }
  });

  $('#form-entrada').addEventListener('click', (e) => {
    if (e.target.closest('[data-agregar]')) {
      filasEntrada.insertAdjacentHTML('beforeend', filaArticulo());
      filasEntrada.lastElementChild.querySelector('input').focus();
    }
    if (e.target.closest('[data-quitar]')) {
      e.target.closest('.fila-articulo').remove();
      if (!filasEntrada.children.length) filasEntrada.innerHTML = filaArticulo();
    }
  });

  $('#form-entrada').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (registrando) return;
    registrando = true;
    const form = e.target;
    const c = form.elements;
    try {
      await api.post('/api/octavio/entradas', {
        proveedor: c.proveedor.value, folio: c.folio.value, nota: c.nota.value, renglones: todasLasFilas(filasEntrada),
      });
      toast(`Entrada ${c.folio.value.trim().toUpperCase()} registrada`);
      form.reset();
      filasEntrada.innerHTML = filaArticulo();
      c.proveedor.focus();
      await recargar();
    } catch (err) {
      toast(err.message, true); // lo escrito se queda para corregirlo
    } finally {
      registrando = false;
    }
  });

  const alEditarEntrada = (e) => {
    const boton = e.target.closest('[data-editar-entrada]');
    if (!boton) return;
    const entrada = entradas.find((x) => x.id === Number(boton.dataset.editarEntrada));
    const c = formEditarEntrada.elements;
    formEditarEntrada.dataset.id = entrada.id;
    $('#editar-entrada-titulo').textContent = `✎ Editar entrada ${entrada.folio ?? 'sin folio'}`;
    c.proveedor.value = entrada.proveedor ?? '';
    c.folio.value = entrada.folio ?? '';
    c.nota.value = entrada.nota ?? '';
    filasEditarEntrada.innerHTML = entrada.renglones.map(filaArticulo).join('');
    $('#editar-entrada-aviso').textContent = '';
    dialogoEntrada.showModal();
  };
  $('#entradas-lista').addEventListener('click', alEditarEntrada);
  $('#pizarron-entradas').addEventListener('click', alEditarEntrada);

  formEditarEntrada.addEventListener('click', (e) => {
    if (e.target.closest('[data-agregar]')) {
      filasEditarEntrada.insertAdjacentHTML('beforeend', filaArticulo());
      filasEditarEntrada.lastElementChild.querySelector('input').focus();
    }
    if (e.target.closest('[data-quitar]')) {
      e.target.closest('.fila-articulo').remove();
      if (!filasEditarEntrada.children.length) filasEditarEntrada.innerHTML = filaArticulo();
    }
    if (e.target.closest('[data-cerrar]')) dialogoEntrada.close();
  });

  formEditarEntrada.addEventListener('submit', async (e) => {
    e.preventDefault();
    const c = formEditarEntrada.elements;
    try {
      await api.put(`/api/octavio/entradas/${formEditarEntrada.dataset.id}`, {
        proveedor: c.proveedor.value, folio: c.folio.value, nota: c.nota.value, renglones: todasLasFilas(filasEditarEntrada),
      });
      dialogoEntrada.close();
      toast('Entrada actualizada');
      await recargar();
    } catch (err) {
      $('#editar-entrada-aviso').textContent = err.message;
    }
  });

  // ---- Pizarrón ----
  document.querySelector('#ventana-ordenes .pestanas').addEventListener('click', (e) => {
    const elegida = e.target.closest('[role="tab"]');
    if (!elegida) return;
    for (const p of document.querySelectorAll('#ventana-ordenes [role="tab"]')) {
      p.setAttribute('aria-selected', String(p === elegida));
      document.getElementById(p.getAttribute('aria-controls')).hidden = p !== elegida;
    }
    $('#pizarron-entradas-barra').hidden = elegida.id !== 'pestana-entradas';
  });
  // Acceso directo del panel: abre el pizarrón ya en su pestaña (oficina.js abre la ventana).
  document.addEventListener('click', (e) => {
    const acceso = e.target.closest('[data-pizarron-pestana]');
    if (acceso) document.getElementById(acceso.dataset.pizarronPestana).click();
  });

  $('#ventana-ordenes').addEventListener('click', async (e) => {
    const plegar = e.target.closest('[data-plegar-orden]');
    if (plegar) {
      const o = ordenes.find((x) => x.id === Number(plegar.dataset.plegarOrden));
      if (o) plegadas.set(o.id, !estaPlegada(o));
      pintarPizarron();
      return;
    }
    const editar = e.target.closest('[data-editar-orden]');
    if (editar) {
      const o = ordenes.find((x) => x.id === Number(editar.dataset.editarOrden));
      const c = formEditar.elements;
      formEditar.dataset.id = o.id;
      $('#editar-orden-titulo').textContent = `✎ Editar ${o.folio}`;
      c.solicitante.value = o.solicitante;
      c.telefono.value = o.telefono ? formatear(o.telefono) : '';
      c.sucursal.value = o.sucursal;
      c.estado.value = o.estado;
      c.nota.value = o.nota ?? '';
      filasEditar.innerHTML = o.renglones.map(filaArticulo).join('');
      $('#editar-orden-aviso').textContent = '';
      dialogo.showModal();
    }
    const mover = e.target.closest('[data-mover-orden]');
    if (mover) {
      mover.disabled = true;
      try {
        const o = await api.patch(`/api/octavio/ordenes/${mover.dataset.moverOrden}/estado`, { estado: mover.dataset.a });
        toast(`${o.folio} pasó a ${ESTATUS[o.estado]}`);
      } catch (err) {
        toast(err.message, true);
      }
      await recargar(); // si falló, la tarjeta vuelve a mostrar lo que hay en la base
      alCambiar();
    }
    // Dos clics: el primero pregunta en el mismo botón; a los 4 s sin confirmar se regresa.
    const eliminar = e.target.closest('[data-eliminar-orden]');
    if (eliminar && !eliminar.dataset.seguro) {
      eliminar.dataset.seguro = '1';
      eliminar.textContent = '¿Seguro? Eliminar';
      setTimeout(() => { if (eliminar.isConnected) { delete eliminar.dataset.seguro; eliminar.textContent = '🗑 Eliminar'; } }, 4000);
    } else if (eliminar) {
      eliminar.disabled = true;
      try {
        const o = ordenes.find((x) => x.id === Number(eliminar.dataset.eliminarOrden));
        await api.delete(`/api/octavio/ordenes/${eliminar.dataset.eliminarOrden}`);
        toast(`${o?.folio ?? 'Orden'} eliminada`);
      } catch (err) {
        toast(err.message, true);
      }
      await recargar();
      alCambiar();
    }
    const reenviar = e.target.closest('[data-reenviar]');
    if (reenviar) {
      reenviar.disabled = true;
      try {
        const r = await api.post(`/api/octavio/ordenes/${reenviar.dataset.reenviar}/enviar`, {});
        toast(ESTADO_WHATSAPP[r.whatsapp], r.whatsapp !== 'enviado');
      } catch (err) {
        toast(err.message, true);
      }
      await recargar();
    }
  });

  // ---- Recibir una orden de Almacén: Entregada / Entregada parcialmente, siempre con folio de entrada ----
  const recibir = $('#recibir-orden');
  const formRecibir = recibir.querySelector('form');
  $('#ventana-ordenes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-recibir-orden]');
    if (!b) return;
    const o = ordenes.find((x) => x.id === Number(b.dataset.recibirOrden));
    if (!o) return;
    const parcial = b.dataset.modo === 'parcial';
    formRecibir.dataset.id = o.id;
    formRecibir.dataset.modo = b.dataset.modo;
    $('#recibir-orden-titulo').textContent = parcial ? `📦 ${o.folio} · Entregada parcialmente` : `✅ ${o.folio} · Entregada`;
    $('#recibir-orden-resumen').innerHTML = `<b>${esc(o.proveedor ?? 'Sin proveedor')}</b> · ${esc(o.solicitante)}`;
    $('#recibir-orden-ayuda').textContent = parcial
      ? 'Escribe cuánto llegó de cada material. Lo que falte se queda pendiente en la orden.'
      : 'Llegó todo lo que faltaba. La orden pasa a Surtidas.';
    $('#recibir-orden-col').textContent = parcial ? 'Llegó' : '';
    $('#recibir-orden-renglones').innerHTML = o.renglones.map((r, i) => ({ ...r, pendiente: o.avance?.[i]?.pendiente ?? aNumero(r.cantidad) })).map((r, i) => `
      <tr><td>${esc(r.material)}</td><td>${esc(r.pendiente)} ${esc(r.unidad)}</td>
      <td>${parcial ? `<input type="number" min="0" max="${esc(r.pendiente)}" step="any" data-renglon="${i}" value="${r.pendiente > 0 ? '' : 0}" ${r.pendiente > 0 ? '' : 'disabled'} aria-label="Llegó de ${esc(r.material)}">` : ''}</td></tr>`).join('');
    formRecibir.elements.folio.value = '';
    $('#recibir-orden-aviso').textContent = '';
    recibir.showModal();
    (parcial ? recibir.querySelector('[data-renglon]:not([disabled])') : formRecibir.elements.folio)?.focus();
  });
  formRecibir.addEventListener('click', (e) => { if (e.target.closest('[data-cerrar]')) recibir.close(); });
  formRecibir.addEventListener('submit', async (e) => {
    e.preventDefault();
    const boton = formRecibir.querySelector('[type="submit"]');
    const parcial = formRecibir.dataset.modo === 'parcial';
    const cantidades = parcial ? [...recibir.querySelectorAll('[data-renglon]')].map((i) => i.value || '0') : null;
    boton.disabled = true;
    try {
      const r = await api.post(`/api/octavio/ordenes/${formRecibir.dataset.id}/recibir`, { folio: formRecibir.elements.folio.value, cantidades });
      recibir.close();
      toast(r.completa ? `${r.orden.folio} entregada: pasó a Surtidas y a Entradas de Almacén` : `${r.orden.folio}: entrada registrada; lo que falta sigue pendiente`);
      await recargar();
      alCambiar();
      $('#pestana-entradas').click(); // se ve la entrada recién registrada
    } catch (err) {
      $('#recibir-orden-aviso').textContent = err.message;
    } finally {
      boton.disabled = false;
    }
  });

  formEditar.addEventListener('click', (e) => {
    if (e.target.closest('[data-agregar]')) {
      filasEditar.insertAdjacentHTML('beforeend', filaArticulo());
      filasEditar.lastElementChild.querySelector('input').focus();
    }
    if (e.target.closest('[data-quitar]')) {
      e.target.closest('.fila-articulo').remove();
      if (!filasEditar.children.length) filasEditar.innerHTML = filaArticulo();
    }
    if (e.target.closest('[data-cerrar]')) dialogo.close();
  });

  formEditar.addEventListener('submit', async (e) => {
    e.preventDefault();
    const c = formEditar.elements;
    try {
      await api.put(`/api/octavio/ordenes/${formEditar.dataset.id}`, {
        solicitante: c.solicitante.value, telefono: c.telefono.value, sucursal: c.sucursal.value, estado: c.estado.value, nota: c.nota.value, renglones: leerFilas(filasEditar),
      });
      dialogo.close();
      toast('Orden actualizada');
      await recargar();
      alCambiar();
    } catch (err) {
      $('#editar-orden-aviso').textContent = err.message;
    }
  });

  recargar();
}
