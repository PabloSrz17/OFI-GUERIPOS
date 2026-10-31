// Abre una ventana visible para iniciar sesión en Pulpos UNA vez. La sesión queda guardada
// en data/pulpos-perfil y el robot la reutiliza. La contraseña sólo la escribe el usuario.
// Detén la Oficina Virtual antes de ejecutarlo: ambos usan el mismo perfil del navegador.
const puppeteer = require('puppeteer');
const { pulpos } = require('../../config');

(async () => {
  console.log('1. Se abrirá una ventana: inicia sesión en Pulpos con tu usuario y contraseña.');
  console.log('2. Cuando veas tu panel de Pulpos, CIERRA esa ventana.');
  const navegador = await puppeteer.launch({ headless: false, userDataDir: pulpos.perfil, defaultViewport: null });
  const [page] = await navegador.pages();
  await page.goto('https://app.pulpos.com');
  await new Promise((listo) => navegador.on('disconnected', listo));
  console.log('Sesión guardada. Inicia la Oficina Virtual con: npm start');
})().catch((err) => {
  console.error('No se pudo abrir el navegador:', err.message);
  console.error('¿Está corriendo la Oficina Virtual? Deténla (Ctrl+C) y vuelve a intentar.');
  process.exit(1);
});
