// Arma el POS para montarlo dentro de la Oficina Virtual (D37): mismo servidor y mismo puerto, en /pos/.
//   <oficina>/pos/pos-modulo.cjs   servidor del POS como módulo (exporta createPosHandler, no abre puerto)
//   <oficina>/pos/app/             la app que abren las PCs
//   <oficina>/pos/sql-wasm.wasm    motor SQLite
// Uso: npm run build:oficina   (carpeta de la Oficina: variable OFICINA_DIR o la de siempre)
// Los datos del POS no van aquí: la Oficina los guarda en data/pos/ (datos y respaldos).
import { build } from 'esbuild';
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const oficina = resolve(process.env.OFICINA_DIR ?? join(root, '..', 'SKILL GITHUB', 'AGENT SKILLS', 'oficina-virtual'));
if (!existsSync(join(oficina, 'src', 'server.js'))) throw new Error(`No encontré la Oficina Virtual en ${oficina} (usa OFICINA_DIR)`);
if (!existsSync(join(root, 'dist', 'index.html'))) throw new Error('Falta dist/: corre "npm run build" primero');

const out = join(oficina, 'pos');
// Solo se reemplazan los archivos del programa; aquí nunca hay datos.
for (const f of ['pos-modulo.cjs', 'app', 'sql-wasm.wasm']) rmSync(join(out, f), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: join(out, 'pos-modulo.cjs'),
  alias: { '@': join(root, 'src') },
  define: { __POS_EMBEDDED__: 'true' },
  logLevel: 'warning',
});
cpSync(join(root, 'dist'), join(out, 'app'), { recursive: true });
copyFileSync(join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'), join(out, 'sql-wasm.wasm'));
writeFileSync(
  join(out, 'LEEME.txt'),
  [
    'PUNTO DE VENTA (POS) DENTRO DE LA OFICINA VIRTUAL',
    '',
    'Esta carpeta la genera el proyecto del POS con "npm run build:oficina". No se edita a mano.',
    'La Oficina la monta en http://localhost:3000/pos/ (src/pos.js). Los datos del POS están en data/pos/.',
    '',
  ].join('\r\n'),
);
console.log(`Listo: ${out}`);
