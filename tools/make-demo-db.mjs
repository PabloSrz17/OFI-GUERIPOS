// Crea una base de prueba con el catálogo y clientes demo (para la prueba integral de varias PCs).
// Uso: node tools/make-demo-db.mjs <archivo.sqlite>
import { build } from 'esbuild';
import { rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const target = resolve(process.argv[2] ?? 'demo.sqlite');
const bundle = join(tmpdir(), `pos-demo-${process.pid}.cjs`);
await build({
  stdin: {
    resolveDir: root,
    loader: 'ts',
    contents: `
      import initSqlJs from 'sql.js';
      import { readFileSync } from 'node:fs';
      import { Database } from '@/db/database';
      import { createDevTools } from '@/db/dev-tools';
      import { ensureBaseData } from '@/repos/bootstrap';
      export async function make() {
        const SQL = await initSqlJs({ wasmBinary: readFileSync(${JSON.stringify(join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'))}) });
        const db = new Database(new SQL.Database());
        await db.write(ensureBaseData);
        const dev = createDevTools(db);
        await dev.seedDemo();
        await dev.seedClients();
        return db.export();
      }`,
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundle,
  alias: { '@': join(root, 'src') },
  logLevel: 'warning',
});
try {
  const { make } = createRequire(import.meta.url)(bundle);
  writeFileSync(target, await make());
} finally {
  rmSync(bundle, { force: true });
}
console.log(`Base demo: ${target}`);
