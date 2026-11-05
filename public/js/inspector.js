// El Inspector: arma la cotización, pregunta "¿Está correcta?" con la tabla editable y, al
// aprobar, muestra la imagen tipo Excel y el resultado del envío por WhatsApp. Las que llegan por
// WhatsApp salen como tarjetas editables en su panel, con [Aceptar y Enviar].
import { api } from './api.js';
import { formatear } from './telefono.js';
import { miniaturaFoto } from './visor-foto.js';
import { filaArticuloConPrecio as filaArticulo } from './captura.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const dinero = (n) => `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ESTADO_WHATSAPP = {
  enviado: '💬 Enviada por WhatsApp al cliente.',
  sin_telefono: 'El cliente no tiene teléfono: descárgala y mándala tú.',
  desconectado: '⏳ WhatsApp no está conectado: no se envió. Usa "Reenviar" cuando se conecte.',
  no_whatsapp: 'Ese número no tiene WhatsApp: no se envió.',
  error: '⚠️ No se pudo enviar por WhatsApp. Intenta "Reenviar".',
};

// Mismas reglas que el servidor (cotizador.js): "1/2" = 0.5, "1 1/2" = 1.5.
export function aNumero(valor) {
  const t = String(valor ?? '').trim();
  const m = t.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
  if (m) return Number(m[3]) > 0 ? Number(m[1] ?? 0) + Number(m[2]) / Number(m[3]) : NaN;
  return t ? Number(t.replace(',', '.')) : NaN;
}

function filaHtml(p, i) {
  const falta = p.precio === null || p.precio === '';
  return `
    <tr data-i="${i}" class="${p.tipo === 'flete' ? 'fila-flete' : ''}">
      <td><input data-campo="descripcion" value="${esc(p.descripcion)}"></td>
      <td><input data-campo="cantidad" value="${esc(p.cantidad)}" class="n"></td>
      <td><input data-campo="unidad" value="${esc(p.unidad)}" class="corto"></td>
      <td><input data-campo="precio" type="number" min="0" step="any" value="${falta ? '' : esc(p.precio)}"
                 class="n ${falta ? 'falta' : ''}" placeholder="${p.tipo === 'flete' ? 'sin flete' : '¿precio?'}"></td>
      <td class="n importe"></td>
    </tr>`;
}

// Datos y tabla editables: los usan el cotizador y las tarjetas del Pizarrón.
function editorHtml(b, extra = '', quitar = false) {
  return `
    <div class="cot__datos">
      <label class="campo">Cliente <input data-dato="cliente" value="${esc(b.cliente)}"></label>
      <label class="campo">📱 WhatsApp <input data-dato="telefono" type="tel" value="${esc(formatear(b.telefono))}" placeholder="opcional"></label>
      <label class="campo">Colonia <input data-dato="colonia" value="${esc(b.colonia)}" placeholder="¿colonia?"></label>
      ${extra}
    </div>
    ${tablaHtml(b.partidas, quitar)}`;
}

// quitar: cada producto lleva su ✕ y abajo va "＋ Agregar artículo" (tarjetas y edición del historial).
function tablaHtml(partidas, quitar = false) {
  const fila = (p, i) => (quitar
    ? filaHtml(p, i).replace(/<\/tr>\s*$/, `<td>${p.tipo === 'flete' ? '' : `<button type="button" class="btn btn--secundario" data-quitar="${i}" aria-label="Quitar renglón">✕</button>`}</td></tr>`)
    : filaHtml(p, i));
  return `
    <div class="cot__tabla">
      <table>
        <thead><tr><th>Descripción</th><th class="n">Cantidad</th><th>Unidad</th><th class="n">Precio</th><th class="n">Importe</th>${quitar ? '<th></th>' : ''}</tr></thead>
        <tbody>${partidas.map(fila).join('')}</tbody>
        <tfoot><tr><td colspan="4" class="n">TOTAL</td><td class="n" data-total></td>${quitar ? '<td></td>' : ''}</tr></tfoot>
      </table>
      ${quitar ? '<button type="button" class="btn btn--secundario cot__agregar" data-renglon>＋ Agregar artículo</button>' : ''}
    </div>
    <p data-aviso class="cot__aviso"></p>`;
}

function recalcular(raiz, b) {
  let total = 0;
  let completos = true;
  raiz.querySelectorAll('tbody tr').forEach((tr) => {
    const p = b.partidas[tr.dataset.i];
    for (const input of tr.querySelectorAll('input')) p[input.dataset.campo] = input.value;
    const sinFlete = p.tipo === 'flete' && !(Number(p.precio) > 0); // opcional: no aparece en la cotización
    const cantidad = aNumero(p.cantidad);
    const falta = !sinFlete && (p.precio === '' || !(Number(p.precio) >= 0) || !(cantidad > 0));
    tr.querySelector('[data-campo="precio"]').classList.toggle('falta', !sinFlete && p.precio === '');
    tr.querySelector('[data-campo="cantidad"]').classList.toggle('falta', !sinFlete && !(cantidad > 0));
    tr.querySelector('.importe').textContent = falta || sinFlete ? '—' : dinero(cantidad * Number(p.precio));
    if (falta) completos = false; else if (!sinFlete) total += cantidad * Number(p.precio);
  });
  raiz.querySelector('[data-total]').textContent = dinero(total);
  const pendientes = b.partidas.filter((p) => p.tipo !== 'flete' && p.precio === '').length;
  const sinFlete = b.partidas.some((p) => p.tipo === 'flete' && !(Number(p.precio) > 0));
  raiz.querySelector('[data-aviso]').textContent = [
    pendientes && `Me faltan ${pendientes} ${pendientes === 1 ? 'precio' : 'precios'} (en amarillo). Los guardo para la próxima.`,
    sinFlete && 'Sin flete: no aparecerá en la cotización.',
  ].filter(Boolean).join(' ');
  raiz.querySelector('[data-accion="aprobar"]').disabled = !completos;
}

// cambio(partidas) agrega o quita; devuelve el índice a enfocar (o nada).
function cambiarRenglones(raiz, b, cambio) {
  recalcular(raiz, b); // guarda lo escrito antes de volver a pintar
  const foco = cambio(b.partidas);
  raiz.querySelector('[data-aviso]').remove();
  raiz.querySelector('.cot__tabla').outerHTML = tablaHtml(b.partidas, true);
  recalcular(raiz, b);
  if (foco !== undefined) raiz.querySelector(`tr[data-i="${foco}"] [data-campo="descripcion"]`)?.focus();
}

const agregarRenglon = (partidas) => {
  const flete = partidas.findIndex((p) => p.tipo === 'flete');
  const i = flete < 0 ? partidas.length : flete; // antes del flete
  partidas.splice(i, 0, { tipo: 'producto', descripcion: '', cantidad: '', unidad: '', precio: '' });
  return i;
};

// Clic en ✕ o en "＋ Agregar artículo"; true si era uno de ésos.
function clicRenglon(raiz, b, e) {
  const quitar = e.target.closest('button[data-quitar]');
  if (quitar) cambiarRenglones(raiz, b, (partidas) => { partidas.splice(Number(quitar.dataset.quitar), 1); });
  else if (e.target.closest('button[data-renglon]')) cambiarRenglones(raiz, b, agregarRenglon);
  else return false;
  return true;
}

function alEscribir(raiz, b, e) {
  if (e.target.closest('tbody')) recalcular(raiz, b);
  if (e.target.dataset.dato === 'colonia') { // el flete sigue a la colonia
    const flete = b.partidas.find((p) => p.tipo === 'flete');
    flete.descripcion = `Flete a ${e.target.value.trim()}`;
    raiz.querySelector('.fila-flete [data-campo="descripcion"]').value = flete.descripcion;
  }
}

function aprobar(raiz, b, enviar) {
  const dato = (campo) => raiz.querySelector(`[data-dato="${campo}"]`)?.value;
  return api.post('/api/cotizaciones', {
    cliente: dato('cliente'),
    telefono: dato('telefono'),
    colonia: dato('colonia'),
    metodo_pago: dato('metodo_pago'),
    solicitud: b.solicitud,
    solicitud_id: b.solicitud_id,
    partidas: b.partidas,
    actualizarPrecios: raiz.querySelector('[data-guardar]').checked,
    enviar,
  });
}

// Lo llama app.js cuando el servidor avisa que llegó o cambió una solicitud ("inspector").
export let recargarSolicitudes = () => {};

export function montarInspector({ toast, alAprobar }) {
  const form = document.querySelector('#form-cotizar');
  const c = form.elements;
  const filas = document.querySelector('#cotizar-articulos');
  const caja = document.querySelector('#cotizacion');
  const recientes = document.querySelector('#cotizaciones-recientes');
  let borrador = null;
  let editando = null; // { cot, partidas }: cotización del historial abierta para corregir
  let historial = [];
  const buscar = document.querySelector('#cotizaciones-buscar');
  // Lista de precios para sugerir el precio al escribir el material (mismas reglas que buscarPrecio del servidor).
  let catalogo = [];
  api.get('/api/cotizaciones/precios').then((r) => { catalogo = r.precios; }).catch(() => {});
  const clave = (t) => ` ${String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]/g, ' ').replace(/s+/g, ' ').trim()} `;
  function precioDeLista(material) {
    const t = clave(material);
    let mejor = null;
    for (const p of catalogo) {
      for (const k of p.claves.split(',').map((x) => x.trim()).filter(Boolean)) {
        if (t.includes(` ${k} `) && k.length > (mejor?.largo ?? 0)) mejor = { precio: p.precio, largo: k.length };
      }
    }
    return mejor?.precio ?? null;
  }
  // Importe de cada renglón y total abajo de los artículos.
  function recalcularFilas() {
    let total = 0;
    let faltan = false;
    for (const fila of filas.querySelectorAll('.fila-articulo')) {
      const material = fila.querySelector('[data-articulo="material"]').value.trim();
      const importe = aNumero(fila.querySelector('[data-articulo="cantidad"]').value) * Number(fila.querySelector('[data-articulo="precio"]').value || NaN);
      fila.querySelector('[data-articulo="importe"]').textContent = importe >= 0 ? dinero(importe) : '—';
      if (importe >= 0) total += importe;
      else if (material) faltan = true;
    }
    document.querySelector('#cotizar-total').textContent = `Total artículos: ${dinero(total)}${faltan ? ' (faltan precios: salen de la lista)' : ''} · el flete se suma al generar`;
  }
  filas.addEventListener('input', (e) => {
    const precio = e.target.closest('.fila-articulo')?.querySelector('[data-articulo="precio"]');
    if (e.target.dataset.articulo === 'precio') delete e.target.dataset.sugerido;
    // Al escribir el material se sugiere el de la lista, sin pisar uno escrito a mano.
    if (e.target.dataset.articulo === 'material' && precio && (!precio.value || precio.dataset.sugerido)) {
      const sugerido = precioDeLista(e.target.value);
      precio.value = sugerido ?? '';
      if (sugerido != null) precio.dataset.sugerido = '1';
    }
    recalcularFilas();
  });

  function mostrarBorrador() {
    caja.innerHTML = `
      <div class="cot">
        ${editorHtml(borrador)}
        <p class="cot__pregunta">🧐 ¿Está correcta esta cotización?</p>
        <label class="cot__opcion"><input type="checkbox" data-guardar checked> Guardar precios nuevos o corregidos en mi lista</label>
        <label class="cot__opcion"><input type="checkbox" id="cot-enviar" ${borrador.telefono ? 'checked' : ''}> Mandársela por WhatsApp al cliente</label>
        <div class="captura__botones cot__botones">
          <button type="button" class="btn" data-accion="aprobar"></button>
          <button type="button" class="btn btn--secundario" data-accion="cancelar">✖ Cancelar</button>
        </div>
      </div>`;
    caja.hidden = false;
    textoDeAprobar();
    recalcular(caja, borrador);
    (caja.querySelector('input.falta') ?? caja.querySelector('[data-accion="aprobar"]')).focus();
  }

  // Sin enviar por WhatsApp, sólo se guarda en el historial.
  function textoDeAprobar() {
    caja.querySelector('[data-accion="aprobar"]').textContent = caja.querySelector('#cot-enviar').checked
      ? '💬 Aceptar y Enviar'
      : '✔ Guardar en el historial';
  }

  function limpiarFormulario() {
    form.reset();
    filas.innerHTML = filaArticulo();
    recalcularFilas();
  }

  function mostrarResultado({ cotizacion, aprendido }) {
    const aprendio = [
      aprendido.nuevos.length && `agregué a la lista: ${aprendido.nuevos.join(', ')}`,
      aprendido.actualizados.length && `actualicé el precio de: ${aprendido.actualizados.join(', ')}`,
      aprendido.flete && `guardé el flete a ${aprendido.flete}`,
    ].filter(Boolean);
    caja.innerHTML = `
      <div class="cot cot--lista">
        <p class="cot__pregunta">✅ Cotización ${esc(cotizacion.folio)} aprobada · ${dinero(cotizacion.total)}</p>
        ${cotizacion.whatsapp ? `<p>${ESTADO_WHATSAPP[cotizacion.whatsapp] ?? ''}</p>` : ''}
        ${aprendio.length ? `<p class="cot__aprendio">🧠 Aprendí: ${esc(aprendio.join('; '))}.</p>` : ''}
        <img class="cot__imagen" src="/api/cotizaciones/${cotizacion.id}/imagen" alt="Cotización ${esc(cotizacion.folio)}">
        <div class="captura__botones cot__botones">
          <a class="btn" href="/api/cotizaciones/${cotizacion.id}/imagen?descargar=1">⬇ Descargar imagen</a>
          <button type="button" class="btn btn--secundario" data-accion="cancelar">Nueva cotización</button>
        </div>
      </div>`;
  }

  // Lo que va después de enviar: marcar Pagada o Cerrada (cancela el recordatorio de 24 horas).
  function filaReciente(c) {
    const recordatorio = {
      pendiente: c.seguimiento_para && `⏰ recordatorio ${c.seguimiento_para.slice(8, 10)}/${c.seguimiento_para.slice(5, 7)} ${c.seguimiento_para.slice(11, 16)}`,
      enviado: '⏰ recordatorio enviado',
      no_whatsapp: '⚠️ recordatorio: sin WhatsApp',
      error: '⚠️ recordatorio no salió',
    }[c.seguimiento_estado];
    const botones = c.estado === 'aprobada'
      ? `<button type="button" class="btn" data-marcar="pagada">💰 Pagada</button>
         <button type="button" class="btn btn--secundario" data-marcar="cerrada">🚫 Cerrar</button>`
      : `<span>${c.estado === 'pagada' ? '💰 Pagada' : '🚫 Cerrada'}</span>
         <button type="button" class="btn btn--secundario" data-marcar="aprobada">↩ Deshacer</button>`;
    return `
      <li data-id="${c.id}">
        <span><a href="/api/cotizaciones/${c.id}/imagen" target="_blank">${esc(c.folio)}</a>
          · ${esc(c.cliente)} · ${esc(c.colonia)} · ${dinero(c.total)} · ${esc(c.creado_en.slice(0, 16))}
          ${c.whatsapp === 'enviado' ? '· 💬' : ''} ${recordatorio ? `· ${recordatorio}` : ''}</span>
        <span class="solicitudes__botones">
          <button type="button" class="btn btn--secundario" data-editar>✏️ Editar</button>
          ${botones}
          ${c.cliente_telefono && c.whatsapp !== 'enviado' ? '<button type="button" class="btn btn--secundario" data-reenviar>💬 Reenviar</button>' : ''}
        </span>
      </li>`;
  }

  function pintarRecientes() {
    const t = buscar.value.trim().toLowerCase();
    const lista = t ? historial.filter((c) => `${c.folio} ${c.cliente} ${c.colonia}`.toLowerCase().includes(t)) : historial;
    recientes.innerHTML = lista.length ? lista.map(filaReciente).join('') : `<li>${t ? 'Ninguna cotización coincide.' : 'Todavía no hay cotizaciones.'}</li>`;
  }

  async function cargarRecientes() {
    try {
      historial = await api.get('/api/cotizaciones?limite=200');
      pintarRecientes();
    } catch { /* se reintenta en la siguiente */ }
  }
  buscar.addEventListener('input', pintarRecientes);

  // ---- Edición manual de una cotización del historial ----
  // El folio se ve pero no se puede cambiar; cliente, WhatsApp y ubicación sí.
  function pintarEdicion() {
    const { cot } = editando;
    const folioFijo = `<label class="campo">Folio <input class="cot__folio" value="${esc(cot.folio)}" readonly aria-readonly="true" tabindex="-1" title="El folio no cambia"></label>`;
    caja.innerHTML = `
      <div class="cot">
        <p class="cot__pregunta">✏️ Editando ${esc(cot.folio)}</p>
        ${editorHtml(editando, folioFijo, true).replace('>Colonia <', '>Ubicación / colonia <')}
        <div class="captura__botones cot__botones">
          <button type="button" class="btn" data-accion="aprobar"></button>
          <button type="button" class="btn btn--secundario" data-accion="guardar">✔ Sólo guardar</button>
          <button type="button" class="btn btn--secundario" data-accion="cancelar">✖ Cancelar</button>
        </div>
        <p data-sin-whatsapp>El cliente no tiene WhatsApp: guárdala y descarga la imagen para mandarla tú.</p>
      </div>`;
    caja.hidden = false;
    recalcularEdicion();
  }

  const telefonoEditado = () => caja.querySelector('[data-dato="telefono"]')?.value.trim() ?? '';

  function recalcularEdicion() {
    recalcular(caja, editando);
    const tel = Boolean(telefonoEditado());
    const aprobar = caja.querySelector('[data-accion="aprobar"]');
    aprobar.textContent = tel ? '💬 Actualizar y Reenviar' : '✔ Guardar cambios';
    const guardar = caja.querySelector('[data-accion="guardar"]');
    guardar.hidden = !tel;
    guardar.disabled = aprobar.disabled;
    caja.querySelector('[data-sin-whatsapp]').hidden = tel;
  }

  async function abrirEdicion(id) {
    const cot = await api.get(`/api/cotizaciones/${id}`);
    const partidas = cot.partidas.map(({ tipo, descripcion, cantidad, unidad, precio }) => ({ tipo, descripcion, cantidad: String(cantidad), unidad, precio }));
    if (!partidas.some((p) => p.tipo === 'flete')) partidas.push({ tipo: 'flete', descripcion: `Flete a ${cot.colonia ?? ''}`, cantidad: '1', unidad: 'viaje', precio: '' });
    borrador = null;
    editando = { cot, partidas, cliente: cot.cliente, telefono: cot.cliente_telefono, colonia: cot.colonia };
    pintarEdicion();
    caja.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function guardarEdicion(enviar) {
    const dato = (campo) => caja.querySelector(`[data-dato="${campo}"]`)?.value ?? '';
    const { cotizacion, whatsapp } = await api.put(`/api/cotizaciones/${editando.cot.id}`, {
      partidas: editando.partidas, enviar, cliente: dato('cliente'), telefono: dato('telefono'), colonia: dato('colonia'),
    });
    editando = null;
    caja.innerHTML = `
      <div class="cot cot--lista">
        <p class="cot__pregunta">✅ Cotización ${esc(cotizacion.folio)} actualizada · ${dinero(cotizacion.total)}</p>
        ${whatsapp ? `<p>${ESTADO_WHATSAPP[whatsapp] ?? ''}</p>` : ''}
        <img class="cot__imagen" src="/api/cotizaciones/${cotizacion.id}/imagen?v=${Date.now()}" alt="Cotización ${esc(cotizacion.folio)}">
        <div class="captura__botones cot__botones">
          <a class="btn" href="/api/cotizaciones/${cotizacion.id}/imagen?descargar=1">⬇ Descargar imagen</a>
          <button type="button" class="btn btn--secundario" data-accion="cancelar">Cerrar</button>
        </div>
      </div>`;
    if (whatsapp && whatsapp !== 'enviado') toast(ESTADO_WHATSAPP[whatsapp] ?? 'No se pudo enviar', true);
  }

  recientes.addEventListener('click', async (e) => {
    const boton = e.target.closest('button');
    const id = boton?.closest('[data-id]')?.dataset.id;
    if (!id) return;
    boton.disabled = true;
    try {
      if (boton.dataset.editar !== undefined) {
        await abrirEdicion(id);
        boton.disabled = false;
        return;
      }
      if (boton.dataset.marcar) {
        await api.post(`/api/cotizaciones/${id}/estado`, { estado: boton.dataset.marcar });
      } else {
        const { whatsapp } = await api.post(`/api/cotizaciones/${id}/enviar`);
        toast(ESTADO_WHATSAPP[whatsapp] ?? 'No se pudo reenviar', whatsapp !== 'enviado');
      }
    } catch (err) {
      toast(err.message, true);
    }
    cargarRecientes();
  });

  function articulos() {
    return [...filas.querySelectorAll('.fila-articulo')].map((fila) => ({
      cantidad: fila.querySelector('[data-articulo="cantidad"]').value.trim(),
      unidad: fila.querySelector('[data-articulo="unidad"]').value.trim(),
      material: fila.querySelector('[data-articulo="material"]').value.trim(),
      precio: fila.querySelector('[data-articulo="precio"]')?.value.trim() ?? '',
    })).filter((a) => a.material);
  }

  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-agregar]')) {
      filas.insertAdjacentHTML('beforeend', filaArticulo());
      filas.lastElementChild.querySelector('input').focus();
    }
    if (e.target.closest('[data-quitar]')) {
      e.target.closest('.fila-articulo').remove();
      if (!filas.children.length) filas.innerHTML = filaArticulo();
      recalcularFilas();
    }
  });

  // Cliente conocido: trae su teléfono si todavía no se escribió uno.
  c.cliente.addEventListener('change', async () => {
    if (c.telefono.value) return;
    const lista = await api.get('/api/clientes').catch(() => []);
    const conocido = lista.find((x) => x.nombre.toLowerCase() === c.cliente.value.trim().toLowerCase());
    if (conocido?.telefono && !c.telefono.value) c.telefono.value = formatear(conocido.telefono);
  });

  // Arma la cotización con sus precios y la enseña. Ningún precio sale sin "Aceptar y Enviar".
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const productos = articulos();
    try {
      borrador = await api.post('/api/cotizaciones/borrador', {
        cliente: c.cliente.value, telefono: c.telefono.value, colonia: c.colonia.value, productos,
      });
      // El precio escrito en el renglón manda sobre el de la lista (las partidas vienen en el mismo orden).
      productos.forEach((p, i) => { if (p.precio !== '' && Number(p.precio) >= 0) borrador.partidas[i].precio = Number(p.precio); });
      borrador.solicitud = productos.map((p) => [p.cantidad, p.unidad, p.material].filter(Boolean).join(' ')).join(' + ');
      mostrarBorrador();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // La línea pegada sólo llena los campos, para revisarlos antes de generar.
  document.querySelector('#cotizar-interpretar').addEventListener('click', async () => {
    const entrada = document.querySelector('#cotizar-texto');
    try {
      const b = await api.post('/api/cotizaciones/borrador', { texto: entrada.value });
      c.cliente.value = b.cliente;
      c.telefono.value = formatear(b.telefono);
      c.colonia.value = b.colonia;
      filas.innerHTML = b.productos.map((p, i) => filaArticulo({ ...p, precio: b.partidas[i]?.precio })).join('');
      recalcularFilas();
      entrada.value = '';
    } catch (err) {
      toast(err.message, true);
    }
  });

  caja.addEventListener('input', (e) => {
    if (!editando) return alEscribir(caja, borrador, e);
    alEscribir(caja, editando, e); // la colonia también cambia el "Flete a …"
    recalcularEdicion();
  });
  caja.addEventListener('change', (e) => { if (e.target.id === 'cot-enviar') textoDeAprobar(); });

  // ---- Tarjetas por autorizar (panel de El Inspector): cotizaciones que llegaron por WhatsApp ----
  const bandeja = document.querySelector('#solicitudes');
  const lista = document.querySelector('#solicitudes-lista');
  const tarjetas = new Map(); // id -> { el, borrador, json, tocada }

  function pintarTarjeta(t, s) {
    t.json = JSON.stringify(s.borrador);
    t.borrador = { ...s.borrador, solicitud: s.mensaje, solicitud_id: s.id };
    t.el.innerHTML = `
      <p class="autorizar__de"><b>${esc(s.nombre)}</b> · ${esc(s.recibido_en.slice(11, 16))}</p>
      <p class="solicitudes__mensaje"></p>
      <div class="auditoria">
        ${miniaturaFoto(s.foto)}
        <div class="auditoria__texto">
          ${editorHtml(t.borrador, `<label class="campo">Método de pago <input data-dato="metodo_pago" value="${esc(s.borrador.metodo_pago)}" placeholder="¿pago?"></label>`, true)}
        </div>
      </div>
      <label class="cot__opcion"><input type="checkbox" data-guardar checked> Guardar precios nuevos o corregidos en mi lista</label>
      <div class="captura__botones cot__botones">
        <button type="button" class="btn" data-accion="aprobar">✔ Aceptar y Enviar</button>
        <button type="button" class="btn btn--secundario" data-accion="nota">📦 Pasar a Notas</button>
        <button type="button" class="btn btn--secundario" data-accion="descartar">✖ Descartar</button>
      </div>`;
    recalcular(t.el, t.borrador);
  }

  async function cargarSolicitudes() {
    let pendientes;
    try {
      pendientes = await api.get('/api/cotizaciones/solicitudes');
    } catch { return; }
    bandeja.hidden = !pendientes.length;
    document.querySelector('#solicitudes-total').textContent = pendientes.length ? `(${pendientes.length})` : '';
    for (const [id, t] of tarjetas) {
      if (!pendientes.some((s) => s.id === id)) { t.el.remove(); tarjetas.delete(id); }
    }
    for (const s of [...pendientes].reverse()) {
      let t = tarjetas.get(s.id);
      if (!t) {
        t = { el: document.createElement('li') };
        t.el.className = 'cot autorizar__tarjeta';
        t.el.dataset.id = s.id;
        tarjetas.set(s.id, t);
        lista.prepend(t.el);
        pintarTarjeta(t, s);
      } else if (!t.tocada && t.json !== JSON.stringify(s.borrador)) {
        pintarTarjeta(t, s); // el cliente mandó más datos; lo que ya editaste no se pisa
      }
      t.el.querySelector('.solicitudes__mensaje').textContent = `"${s.mensaje}"`;
    }
  }

  lista.addEventListener('input', (e) => {
    const t = tarjetas.get(Number(e.target.closest('[data-id]').dataset.id));
    t.tocada = true;
    alEscribir(t.el, t.borrador, e);
  });
  lista.addEventListener('click', async (e) => {
    const tarjeta = tarjetas.get(Number(e.target.closest('[data-id]')?.dataset.id));
    if (tarjeta && clicRenglon(tarjeta.el, tarjeta.borrador, e)) {
      tarjeta.tocada = true; // ya no se pisa con lo que mande el cliente
      return;
    }
    const boton = e.target.closest('button[data-accion]');
    if (!boton) return;
    const id = Number(boton.closest('[data-id]').dataset.id);
    const t = tarjetas.get(id);
    boton.disabled = true;
    try {
      if (boton.dataset.accion === 'descartar') {
        await api.post(`/api/cotizaciones/solicitudes/${id}/descartar`);
      } else if (boton.dataset.accion === 'nota') {
        const dato = (campo) => t.el.querySelector(`[data-dato="${campo}"]`)?.value;
        const nota = await api.post(`/api/cotizaciones/solicitudes/${id}/nota`, {
          cliente: dato('cliente'), telefono: dato('telefono'), colonia: dato('colonia'), partidas: t.borrador.partidas,
        });
        toast(`${nota.folio} guardada en Pendiente`);
        alAprobar();
      } else {
        const { cotizacion } = await aprobar(t.el, t.borrador, true);
        toast(`${cotizacion.folio} · ${ESTADO_WHATSAPP[cotizacion.whatsapp] ?? ''}`, cotizacion.whatsapp !== 'enviado');
        cargarRecientes();
        alAprobar();
      }
      cargarSolicitudes();
    } catch (err) {
      toast(err.message, true);
      boton.disabled = false;
    }
  });
  cargarSolicitudes();
  recargarSolicitudes = () => { cargarSolicitudes(); cargarRecientes(); };

  caja.addEventListener('click', async (e) => {
    if (editando && clicRenglon(caja, editando, e)) {
      recalcularEdicion();
      return;
    }
    const boton = e.target.closest('button[data-accion]');
    if (!boton) return;
    if (editando && (boton.dataset.accion === 'aprobar' || boton.dataset.accion === 'guardar')) {
      caja.querySelectorAll('[data-accion="aprobar"], [data-accion="guardar"]').forEach((b) => { b.disabled = true; });
      try {
        await guardarEdicion(boton.dataset.accion === 'aprobar' && Boolean(telefonoEditado()));
        cargarRecientes();
      } catch (err) {
        toast(err.message, true);
        recalcularEdicion();
      }
      return;
    }
    if (boton.dataset.accion === 'cancelar') {
      caja.hidden = true;
      caja.innerHTML = '';
      borrador = null;
      editando = null;
      c.cliente.focus();
      return;
    }
    if (boton.dataset.accion === 'aprobar') {
      boton.disabled = true;
      try {
        const resultado = await aprobar(caja, borrador, caja.querySelector('#cot-enviar').checked);
        mostrarResultado(resultado);
        limpiarFormulario();
        cargarRecientes();
        alAprobar();
      } catch (err) {
        toast(err.message, true);
        boton.disabled = false;
      }
    }
  });

  limpiarFormulario();
  cargarRecientes();
}
