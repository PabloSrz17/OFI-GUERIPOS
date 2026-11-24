// Actualización automática del Mostrador con el programa del Principal (src/sync/programa.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { manifiesto, rutaSegura, crearActualizador } = require('../src/sync/programa');

function carpeta(archivos) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'programa-'));
  for (const [ruta, texto] of Object.entries(archivos)) {
    fs.mkdirSync(path.dirname(path.join(raiz, ruta)), { recursive: true });
    fs.writeFileSync(path.join(raiz, ruta), texto);
  }
  return raiz;
}
const leer = (raiz, ruta) => fs.readFileSync(path.join(raiz, ruta), 'utf8');

function preparar(principal, mostrador, { bajar } = {}) {
  const P = carpeta(principal);
  const M = carpeta(mostrador);
  let reinicios = 0;
  const act = crearActualizador({
    raiz: M,
    datos: path.join(M, 'data'),
    pedir: async () => manifiesto(P),
    bajar: bajar ?? (async (ruta) => fs.readFileSync(path.join(P, ruta))),
    reiniciar: () => reinicios++,
    log: () => {},
  });
  return { P, M, act, reinicios: () => reinicios };
}

test('manifiesto: sólo el programa, sin .env ni data ni node_modules', () => {
  const raiz = carpeta({ 'src/a.js': '1', 'public/x.html': '2', 'package.json': '{}', '.env': 'SECRETO=1', 'data/db.sqlite': 'x', 'node_modules/m/i.js': 'x', 'scripts/google-sheets/token.txt': 't' });
  assert.deepEqual(manifiesto(raiz).archivos.map((a) => a.ruta), ['package.json', 'public/x.html', 'src/a.js']);
  assert.equal(rutaSegura(raiz, 'src/../.env'), null);
  assert.equal(rutaSegura(raiz, '.env'), null);
  assert.equal(rutaSegura(raiz, 'data/database.sqlite'), null);
  assert.ok(rutaSegura(raiz, 'src/sync/programa.js'));
});

test('espera a que el programa nuevo no cambie, lo baja, respalda y reinicia', async () => {
  const { M, act, reinicios } = preparar(
    { 'src/a.js': 'nuevo', 'src/b.js': 'agregado', 'public/igual.js': 'igual' },
    { 'src/a.js': 'viejo', 'public/igual.js': 'igual', '.env': 'MIO=1' },
  );
  assert.match(await act.revisar(), /siguiente revisión/);
  assert.equal(leer(M, 'src/a.js'), 'viejo');
  assert.match(await act.revisar(), /Reiniciando/);
  assert.equal(leer(M, 'src/a.js'), 'nuevo');
  assert.equal(leer(M, 'src/b.js'), 'agregado');
  assert.equal(leer(M, '.env'), 'MIO=1');
  assert.equal(leer(M, 'data/actualizacion/anterior/src/a.js'), 'viejo');
  const p = JSON.parse(leer(M, 'data/actualizacion/pendiente.json'));
  assert.deepEqual([p.archivos, p.nuevos, p.intentos], [['src/a.js'], ['src/b.js'], 0]);
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(reinicios(), 1);
  // Mientras no se confirme el arranque no vuelve a actualizar.
  assert.match(await act.revisar(), /Reiniciando/);
});

test('al día: no hace nada', async () => {
  const { act } = preparar({ 'src/a.js': '1' }, { 'src/a.js': '1' });
  assert.equal(await act.revisar(), 'Al día');
});

test('si llega un archivo incompleto no cambia nada', async () => {
  const { M, act } = preparar({ 'src/a.js': 'nuevo' }, { 'src/a.js': 'viejo' }, { bajar: async () => Buffer.from('roto') });
  await act.revisar();
  assert.match(await act.revisar(), /incompleto/);
  assert.equal(leer(M, 'src/a.js'), 'viejo');
  assert.equal(fs.existsSync(path.join(M, 'data/actualizacion/pendiente.json')), false);
});

test('dependencias nuevas: no se actualiza solo', async () => {
  const { M, act } = preparar({ 'src/a.js': 'nuevo', 'package-lock.json': '{"v":2}' }, { 'src/a.js': 'viejo', 'package-lock.json': '{"v":1}' });
  await act.revisar();
  assert.match(await act.revisar(), /INSTALAR\.cmd/);
  assert.equal(leer(M, 'src/a.js'), 'viejo');
});

test('una versión que no arrancó no se vuelve a intentar', async () => {
  const { P, M, act } = preparar({ 'src/a.js': 'nuevo' }, { 'src/a.js': 'viejo' });
  fs.mkdirSync(path.join(M, 'data/actualizacion'), { recursive: true });
  fs.writeFileSync(path.join(M, 'data/actualizacion/rechazada.txt'), manifiesto(P).version);
  assert.match(await act.revisar(), /no arrancó/);
  assert.equal(leer(M, 'src/a.js'), 'viejo');
});
