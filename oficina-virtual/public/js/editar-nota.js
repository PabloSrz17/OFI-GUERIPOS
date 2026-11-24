// Ventana ✎ Editar: cambia cualquier dato de una nota ya guardada y agrega o quita artículos.
import { api } from './api.js';
import { formatear } from './telefono.js';
import { miniaturaFoto } from './visor-foto.js';
import { faltaDireccion } from './kanban.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const LINEA = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)\s*(?:[×x]\s+)?(?:(m³|m3|pz|bultos?|viajes?|kg|ton)\s+)?(.*)$/i;

// "30 pz MASILLA" | "6 × CEMENTO" | "1/2 m³ GRAVA" | "media carga" -> renglón del editor
function leerLinea(linea) {
  const m = linea.trim().match(LINEA);
  return m ? { cantidad: m[1], unidad: m[2] ?? '', material: m[3] } : { cantidad: '', unidad: '', material: linea.trim() };
}

const articulosDe = (nota) => (nota.detalle
  ? nota.detalle.split('\n').filter((l) => l.trim()).map(leerLinea)
  : [{ cantidad: nota.cantidad, unidad: nota.unidad, material: nota.material }]);

const filaArticulo = (a = {}) => `
  <div class="fila-articulo">
    <label class="campo">Cantidad <input data-articulo="cantidad" value="${esc(a.cantidad)}"></label>
    <label class="campo">Unidad <input data-articulo="unidad" value="${esc(a.unidad)}"></label>
    <label class="campo">Descripción <input data-articulo="material" value="${esc(a.material)}"></label>
    <button type="button" class="fila-articulo__quitar" data-quitar aria-label="Quitar artículo">✕</button>
  </div>`;

const opciones = (lista, actual) => `<option value="">— Sin asignar —</option>${lista.map((o) =>
  `<option value="${o.id}" ${o.id === actual ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}`;

const AVISOS = {
  en_ruta: 'El cliente ya recibió su aviso de ruta; no se le manda otro.',
  entregado: 'Ya está entregada: el cambio también se aplica a su renglón en la hoja de reparto.',
};

export function montarEditarNota({ notaPorId, catalogos, alGuardar, toast }) {
  const dialogo = document.querySelector('#editar-nota');
  const form = dialogo.querySelector('form');
  const filas = dialogo.querySelector('#editar-articulos');
  const aviso = dialogo.querySelector('#editar-aviso');
  let nota = null;

  // Se abre desde la tarjeta o desde el panel de Sulema. foco: 'direccion' lleva directo a esa casilla.
  function abrir(id, foco) {
    nota = notaPorId(id);
    dialogo.querySelector('#editar-foto').innerHTML = miniaturaFoto(nota.foto);
    dialogo.querySelector('#editar-estado').textContent = AVISOS[nota.estado] ?? '';
    aviso.textContent = '';
    filas.innerHTML = articulosDe(nota).map(filaArticulo).join('');
    const { elements: c } = form;
    c.folio.value = nota.folio;
    c.cliente.value = nota.cliente;
    c.telefono.value = formatear(nota.cliente_telefono);
    c.direccion.value = nota.direccion;
    c.zona.value = nota.zona ?? '';
    c.total.value = nota.total ?? '';
    c.chofer_id.innerHTML = opciones(catalogos.choferes, nota.chofer_id);
    c.camion_id.innerHTML = opciones(catalogos.camiones, nota.camion_id);
    camionSegunChofer();
    dialogo.showModal();
    if (foco === 'direccion') {
      if (faltaDireccion(nota)) c.direccion.value = '';
      c.direccion.focus();
    }
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-accion="editar"]');
    if (btn) abrir(btn.dataset.id, btn.dataset.foco);
  });

  // ALMACÉN no lleva camión: la casilla se vacía y se bloquea.
  function camionSegunChofer() {
    const { chofer_id: chofer, camion_id: camion } = form.elements;
    const almacen = Boolean(catalogos.choferes.find((o) => String(o.id) === chofer.value)?.almacen);
    if (almacen) camion.value = '';
    camion.disabled = almacen;
  }
  form.elements.chofer_id.addEventListener('change', camionSegunChofer);

  dialogo.addEventListener('click', (e) => {
    if (e.target.closest('[data-agregar]')) {
      filas.insertAdjacentHTML('beforeend', filaArticulo());
      filas.lastElementChild.querySelector('input').focus();
    }
    if (e.target.closest('[data-quitar]')) e.target.closest('.fila-articulo').remove();
    if (e.target.closest('[data-cerrar]')) dialogo.close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const articulos = [...filas.querySelectorAll('.fila-articulo')].map((fila) => ({
      cantidad: fila.querySelector('[data-articulo="cantidad"]').value.trim(),
      unidad: fila.querySelector('[data-articulo="unidad"]').value.trim(),
      material: fila.querySelector('[data-articulo="material"]').value.trim(),
    })).filter((a) => a.material);
    const linea = (a) => [a.cantidad, a.unidad, a.material].filter(Boolean).join(' ');
    try {
      const guardada = await api.patch(`/api/notas/${nota.id}`, {
        ...Object.fromEntries(new FormData(form)),
        ...articulos[0],
        detalle: articulos.length > 1 ? articulos.map(linea).join('\n') : null,
      });
      dialogo.close();
      toast(`${guardada.folio} actualizada`);
      await alGuardar();
    } catch (err) {
      aviso.textContent = err.message; // sigue abierta para no perder lo escrito
    }
  });
}
