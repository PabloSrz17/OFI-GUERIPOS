// Arma la carpeta "Servidor POS" para llevar a la PC servidor (D32):
//   build/ServidorPOS/ServidorPOS.exe   programa (Node empaquetado, no requiere instalar nada)
//   build/ServidorPOS/app/              la app que abren las PCs en el navegador
//   build/ServidorPOS/sql-wasm.wasm     motor SQLite
//   build/ServidorPOS/*.cmd, LEEME.txt  instalación
// Uso: npm run build:server   (con --no-exe solo arma servidor.cjs, para pruebas)
// Usuario inicial (opcional): variables POS_USUARIO y POS_CONTRASENA. Se guarda solo el hash en
// acceso-inicial.json; el servidor lo usa la primera vez, si todavía no hay usuarios. build/ no se sube a git.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'build', 'ServidorPOS');
const noExe = process.argv.includes('--no-exe');

// Si alguien abrió el servidor desde esta carpeta, ya tiene datos: nunca se borran al rearmar.
if (existsSync(join(out, 'datos')) || existsSync(join(out, 'respaldos'))) {
  throw new Error(`${out} tiene datos o respaldos (se usó como servidor). Muévelos a otra carpeta antes de rearmar.`);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: join(out, 'servidor.cjs'),
  alias: { '@': join(root, 'src') },
  // sql.js trae ramas para navegador que piden 'fs'/'path'/'crypto' de forma opcional.
  external: [],
  logLevel: 'warning',
});

if (!existsSync(join(root, 'dist', 'index.html'))) throw new Error('Falta dist/: corre "npm run build" primero');
cpSync(join(root, 'dist'), join(out, 'app'), { recursive: true });
copyFileSync(join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'), join(out, 'sql-wasm.wasm'));
cpSync(join(root, 'tools/server-files'), out, { recursive: true });

const { POS_USUARIO: user, POS_CONTRASENA: password } = process.env;
if (user && password) {
  // Mismo hash que src/server/auth.ts (scrypt N=16384, r=8, p=1, 64 bytes).
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  writeFileSync(join(out, 'acceso-inicial.json'), JSON.stringify({ users: [{ name: user, salt, hash, created_at: new Date().toISOString() }] }, null, 2));
  console.log(`Usuario inicial: ${user}`);
}

if (!noExe) {
  const cfg = join(out, 'sea-config.json');
  writeFileSync(cfg, JSON.stringify({ main: join(out, 'servidor.cjs'), output: join(out, 'ServidorPOS.exe'), disableExperimentalSEAWarning: true, useCodeCache: false }));
  execFileSync(process.execPath, ['--build-sea', cfg], { stdio: 'inherit' });
  rmSync(cfg);
  rmSync(join(out, 'servidor.cjs'));
}
console.log(`Listo: ${out}`);
