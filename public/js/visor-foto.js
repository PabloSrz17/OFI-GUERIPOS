// Foto original del cliente: miniatura junto al texto y, con un clic, ventana para verla grande.
// Otro clic sobre la foto la pone a tamaño real, para revisar detalles finos.
export const miniaturaFoto = (foto) => (foto
  ? `<button type="button" class="foto-mini" data-foto="/api/cotizaciones/fotos/${encodeURIComponent(foto)}" title="Ampliar foto del cliente" aria-label="Ampliar foto del cliente">
       <img src="/api/cotizaciones/fotos/${encodeURIComponent(foto)}" alt="Foto del cliente" draggable="false" loading="lazy">
     </button>`
  : '');

export function montarVisorFoto() {
  const visor = document.querySelector('#visor-foto');
  const img = visor.querySelector('img');
  document.addEventListener('click', (e) => {
    const mini = e.target.closest('[data-foto]');
    if (mini) {
      img.src = mini.dataset.foto;
      visor.classList.remove('visor--real');
      visor.showModal();
    } else if (e.target === img) {
      visor.classList.toggle('visor--real');
    } else if (e.target.closest('[data-cerrar-visor]') || e.target === visor) {
      visor.close();
    }
  });
}
