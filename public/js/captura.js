// Captura de notas a mano, por campos: un renglón por artículo, con autocompletado de clientes y
// materiales. También se puede pegar la nota en una línea: el servidor la interpreta y llena los campos.
import { api } from './api.js';
import { formatear } from './telefono.js';
import { etiquetaOrigen } from './kanban.js';
import { leerImagen, interpretarTicket } from './leer-ticket.js';

const MIN_CONFIANZA = 45; // menos que esto suele ser letra a mano o foto borrosa: mejor no llenar con basura
const CONFIANZA_BUENA = 75; // el PDF de SICAR da 85 o más; la foto del impreso, unos 60 y con errores
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const filaArticulo = (a = {}) => `
  <div class="fila-articulo">
    <label class="campo">Cantidad <input data-articulo="cantidad" value="${esc(a.cantidad)}" placeholder="7, 1/2…"></label>
    <label class="campo">Unidad <input data-articulo="unidad" value="${esc(a.unidad)}" list="lista-unidades-captura" placeholder="m³, b…"></label>
    <label class="campo">Material <input data-articulo="material" value="${esc(a.material)}" list="lista-materiales"></label>
    <button type="button" class="fila-articulo__quitar" data-quitar aria-label="Quitar artículo">✕</button>
  </div>`;

// La de Nueva cotización: además, precio unitario e importe (cantidad × precio, se calcula solo).
export const filaArticuloConPrecio = (a = {}) => filaArticulo(a)
  .replace('<div class="fila-articulo">', '<div class="fila-articulo fila-articulo--precio">')
  .replace('<button type="button" class="fila-articulo__quitar"', `<label class="campo">Precio $ <input data-articulo="precio" type="number" min="0" step="any" inputmode="decimal" value="${esc(a.precio ?? '')}" placeholder="de la lista"></label>
    <p class="campo fila-articulo__importe">Importe <output data-articulo="importe">—</output></p>
    <button type="button" class="fila-articulo__quitar"`);

export function montarCaptura({ alGuardar, toast }) {
  const form = document.querySelector('#form-captura');
  const filas = document.querySelector('#captura-articulos');
  const etiqueta = document.querySelector('#captura-etiqueta');
  const c = form.elements;
  let clientes = [];
  let elegida = null; // etiqueta escogida a mano

  function limpiar() {
    form.reset();
    document.querySelector('#captura-ocr').hidden = true;
    filas.innerHTML = filaArticulo();
    elegida = null;
    pintarEtiqueta();
  }

  // SC o SALIDA: la que toca por el folio que se va escribiendo, o la elegida con un clic.
  function pintarEtiqueta() {
    const { texto, clase } = etiquetaOrigen({ origen: 'sicar', folio: c.folio.value, etiqueta: elegida });
    etiqueta.textContent = texto;
    etiqueta.className = `origen origen--${clase} origen--boton`;
  }

  etiqueta.addEventListener('click', () => {
    elegida = etiqueta.textContent === 'SC' ? 'SALIDA' : 'SC';
    pintarEtiqueta();
  });

  async function cargarListas() {
    try {
      const [lista, { precios }] = await Promise.all([api.get('/api/clientes'), api.get('/api/cotizaciones/precios')]);
      clientes = lista;
      document.querySelector('#lista-clientes').innerHTML = lista.map((x) => `<option value="${esc(x.nombre)}"></option>`).join('');
      document.querySelector('#lista-materiales').innerHTML = precios.map((p) => `<option value="${esc(p.nombre)}"></option>`).join('');
    } catch { /* sin listas también se puede capturar */ }
  }

  function articulos() {
    return [...filas.querySelectorAll('.fila-articulo')].map((fila) => ({
      cantidad: fila.querySelector('[data-articulo="cantidad"]').value.trim(),
      unidad: fila.querySelector('[data-articulo="unidad"]').value.trim(),
      material: fila.querySelector('[data-articulo="material"]').value.trim().toUpperCase(),
    })).filter((a) => a.material);
  }

  form.addEventListener('input', (e) => { if (e.target === c.folio) pintarEtiqueta(); });

  // Cliente conocido: trae su teléfono si todavía no se escribió uno.
  c.cliente.addEventListener('change', () => {
    const conocido = clientes.find((x) => x.nombre.toLowerCase() === c.cliente.value.trim().toLowerCase());
    if (conocido?.telefono && !c.telefono.value) c.telefono.value = formatear(conocido.telefono);
  });

  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-agregar]')) {
      filas.insertAdjacentHTML('beforeend', filaArticulo());
      filas.lastElementChild.querySelector('input').focus();
    }
    if (e.target.closest('[data-quitar]')) {
      e.target.closest('.fila-articulo').remove();
      if (!filas.children.length) filas.innerHTML = filaArticulo();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const lista = articulos();
    if (!lista.length) {
      toast('Falta al menos un artículo', true);
      return;
    }
    const principal = lista.find((a) => a.cantidad);
    if (!principal) {
      toast('Falta la cantidad de al menos un artículo', true);
      return;
    }
    const linea = (a) => [a.cantidad, a.unidad, a.material].filter(Boolean).join(' ');
    try {
      const nota = await api.post('/api/notas', {
        origen: 'sicar',
        etiqueta: elegida,
        folio: c.folio.value,
        cliente: c.cliente.value.trim().toUpperCase(),
        telefono: c.telefono.value,
        ...principal,
        unidad: principal.unidad,
        detalle: lista.length > 1 ? lista.map(linea).join('\n') : null,
        direccion: c.direccion.value,
        total: c.total.value,
        hora: c.hora.value,
      });
      toast(`${nota.folio} guardada en Pendiente`);
      limpiar();
      c.folio.focus();
      await alGuardar();
      cargarListas();
    } catch (err) {
      toast(err.message, true); // lo escrito se queda para corregirlo
    }
  });

  // La línea pegada sólo llena los campos: se guarda después de revisarla.
  document.querySelector('#captura-interpretar').addEventListener('click', async () => {
    const entrada = document.querySelector('#captura-texto');
    try {
      const nota = await api.post('/api/notas/interpretar', { texto: entrada.value });
      c.folio.value = nota.folio;
      c.cliente.value = nota.cliente;
      c.telefono.value = nota.telefono ? formatear(nota.telefono) : '';
      c.direccion.value = nota.direccion;
      c.total.value = nota.total ?? '';
      c.hora.value = nota.hora ? nota.hora.padStart(5, '0') : '';
      filas.innerHTML = nota.productos.map(filaArticulo).join('');
      pintarEtiqueta();
      entrada.value = '';
      c.folio.focus();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---- Imagen del ticket: Ctrl + V o arrastrarla sobre la Nueva nota. Sólo llena los campos. ----
  const zona = form.closest('.captura');
  const ocr = document.querySelector('#captura-ocr');
  const miniatura = ocr.querySelector('img');
  const estado = ocr.querySelector('span');
  let leyendo = false;

  function mostrar(archivo, texto) {
    if (archivo) {
      URL.revokeObjectURL(miniatura.src);
      miniatura.src = URL.createObjectURL(archivo);
    }
    estado.textContent = texto;
    ocr.hidden = false;
    ocr.scrollIntoView({ block: 'nearest' }); // el panel es largo: que se vea aunque estés en la conversación
  }

  const CAMPOS = { folio: 'el folio', cliente: 'el cliente', direccion: 'la dirección' };

  async function procesarImagen(archivo) {
    if (leyendo) {
      toast('Todavía estoy leyendo la imagen anterior', true);
      return;
    }
    leyendo = true;
    mostrar(archivo, '⏳ Imagen cargada. Leyendo el texto…');
    try {
      const { texto, confianza } = await leerImagen(archivo);
      const datos = confianza < MIN_CONFIANZA ? {} : interpretarTicket(texto);
      const { dudas, ...resto } = datos;
      // En la foto del impreso se pierden renglones y salen mal cantidades y medidas (7 en vez de 25):
      // esos datos no se llenan, para que nada mal leído se reparta. Sólo lo demás.
      const dificil = confianza < CONFIANZA_BUENA;
      const { articulos: leidos, total, ...basicos } = resto;
      const articulos = dificil ? null : leidos;
      const campos = dificil ? basicos : { ...basicos, ...(total ? { total } : {}) };
      if (!articulos && !Object.keys(campos).length) {
        mostrar(null, '⚠️ No pude leer datos en esta imagen. Captúrala a mano.');
        return;
      }
      Object.entries(campos).forEach(([campo, valor]) => { c[campo].value = valor; });
      if (articulos) filas.innerHTML = articulos.map(filaArticulo).join('');
      pintarEtiqueta();
      const faltan = Object.keys(CAMPOS).filter((k) => !campos[k]).map((k) => CAMPOS[k]);
      if (!articulos && !dificil) faltan.push('los artículos');
      const falta = faltan.length ? ` Falta ${faltan.join(', ')}.` : '';
      if (dificil) mostrar(null, `⚠️ Esta foto no se lee con seguridad: los artículos y el total captúralos a mano. Revisa lo que sí llené.${falta}`);
      else if (dudas) mostrar(null, `⚠️ Los importes no cuadran: hay algo mal leído. Revisa renglón por renglón.${falta}`);
      else mostrar(null, `✔ Campos llenados: compáralos contra el ticket.${falta}`);
    } catch (err) {
      console.error('[ticket]', err);
      mostrar(null, '⚠️ No se pudo leer la imagen. Captúrala a mano.');
    } finally {
      leyendo = false;
    }
  }

  // Sólo con la Nueva nota a la vista y sin otra ventana encima.
  const aLaVista = () => form.offsetParent !== null
    && [...document.querySelectorAll('dialog[open]')].every((d) => d.contains(form));

  document.addEventListener('paste', (e) => {
    const imagen = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!imagen || !aLaVista()) return;
    // Copiar de Excel trae imagen y texto: en una casilla, manda el texto.
    if (e.target.closest?.('input, textarea') && e.clipboardData.types.includes('text/plain')) return;
    e.preventDefault();
    procesarImagen(imagen);
  });

  zona.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    zona.classList.add('captura--soltar');
  });
  zona.addEventListener('dragleave', (e) => {
    if (!zona.contains(e.relatedTarget)) zona.classList.remove('captura--soltar');
  });
  zona.addEventListener('drop', (e) => {
    zona.classList.remove('captura--soltar');
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    const imagen = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (imagen) procesarImagen(imagen);
    else toast('Eso no es una imagen', true);
  });

  limpiar();
  cargarListas();
}
