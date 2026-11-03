// Octavio: alerta flotante con la orden que llegó por WhatsApp, su pizarrón de órdenes de compra
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

// Lo llama app.js cuando el servidor avisa que cambió algo de Octavio.
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
    $('#ordenes-espera-lista').innerHTML = lista.map((o) => `
      <li><b>${esc(o.folio)}</b> ${esc(o.solicitante)}
        <button type="button" class="btn btn--secundario" data-revisar="${o.id}">Revisar</button></li>`).join('');
  }

  function tarjeta(o) {
    const sinEnviar = o.estado === 'aprobada' && o.whatsapp !== 'enviado';
    return `
      <article class="orden">
        <header><b>${esc(o.folio)}</b> <span class="orden__estado orden__estado--${esc(o.estado)}">${esc(ESTATUS[o.estado])}</span> <span>${esc(o.sucursal)}</span></header>
        <p class="orden__de">${esc(o.solicitante)} · ${esc((o.aprobada_en ?? o.creado_en).slice(0, 16))}</p>
        <ul>${o.renglones.map((r) => `<li>${esc(linea(r))}</li>`).join('')}</ul>
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
      </article>`;
  }

  function pintarPizarron() {
    for (const estado of ['aprobada', 'surtida', 'cancelada']) {
      const lista = ordenes.filter((o) => o.estado === estado);
      const col = document.querySelector(`[data-orden-estado="${estado}"]`);
      col.querySelector('.contador').textContent = lista.length;
      col.querySelector('.ordenes__lista').innerHTML = lista.map(tarjeta).join('') || '<p class="ordenes__vacio">Sin órdenes</p>';
    }
    $('#pestana-ordenes-n').textContent = ordenes.filter((o) => o.estado in ESTATUS).length;
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

  function pintarTableroEntradas() {
    const aviso = entradas.length >= MAX_ENTRADAS ? `<p class="tablero-entradas__aviso">Se muestran las ${MAX_ENTRADAS} más recientes.</p>` : '';
    $('#pestana-entradas-n').textContent = entradas.length;
    $('#pizarron-entradas').innerHTML = aviso + (entradas.map(tarjetaEntrada).join('') || '<p class="ordenes__vacio">Sin entradas todavía.</p>');
  }

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

  // ---- Panel de Octavio ----
  espera.addEventListener('click', (e) => {
    const boton = e.target.closest('[data-revisar]');
    if (!boton) return;
    const orden = ordenes.find((o) => o.id === Number(boton.dataset.revisar));
    oculta = new Set([...oculta].filter((k) => !k.startsWith(`${orden.id}|`)));
    alerta.hidden = false;
    pintarAlerta(orden, porAprobar().length);
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
  });

  $('#ventana-ordenes').addEventListener('click', async (e) => {
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
