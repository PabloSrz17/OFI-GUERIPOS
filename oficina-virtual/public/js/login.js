// Pantalla del PIN: crearlo la primera vez (sólo en la PC principal) o entrar.
const $ = (s) => document.querySelector(s);
const form = $('#pin-form');
const uno = $('#pin-uno');
const dos = $('#pin-dos');
let creando = false;

async function enviar(ruta, pin) {
  const res = await fetch(`/api/pin/${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(datos.error || `Error ${res.status}`);
}

async function iniciar() {
  const { hayPin, puedeCrear, dentro } = await fetch('/api/pin/estado').then((r) => r.json());
  if (dentro) {
    location.replace('/');
    return;
  }
  if (!hayPin && !puedeCrear) {
    $('#pin-texto').textContent = 'Todavía no hay PIN. Hay que crearlo en la PC principal, abriendo http://localhost:3000.';
    return;
  }
  creando = !hayPin;
  $('#pin-texto').textContent = creando
    ? 'Crea el PIN de la Oficina: de 6 a 12 números. Lo necesitarán todas las PCs.'
    : 'Escribe el PIN para entrar.';
  $('#pin-dos-campo').hidden = !creando;
  $('#pin-boton').textContent = creando ? 'Crear PIN y entrar' : 'Entrar';
  form.hidden = false;
  uno.focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#pin-error').textContent = '';
  if (creando && uno.value !== dos.value) {
    $('#pin-error').textContent = 'Los dos PIN no coinciden.';
    return;
  }
  try {
    await enviar(creando ? 'crear' : 'entrar', uno.value);
    location.replace('/');
  } catch (err) {
    $('#pin-error').textContent = err.message;
    uno.value = '';
    dos.value = '';
    uno.focus();
  }
});

iniciar().catch(() => { $('#pin-texto').textContent = 'No hay conexión con la Oficina.'; });
