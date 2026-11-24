// Arma un respaldo del POS (.sqlite) con los datos descargados de Pulpos (D34).
// Uso: node tools/import/pulpos.mjs [AAAA-MM]   (por defecto, el mes actual)
// Lee los Excel más recientes de importar/pulpos/ y escribe importar/pos-desde-pulpos-AAAA-MM-DD_HHMM.sqlite.
// Ese archivo se restaura en el POS: Preferencias > Respaldo > Elegir Archivo… > Restaurar.
import { build } from 'esbuild';
import { readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { asObjects, readXlsx } from './xlsx.mjs';

const root = resolve(import.meta.dirname, '../..');
const dir = join(root, 'importar', 'pulpos');
const now = new Date();
const month = process.argv[2] ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('El mes va como AAAA-MM, por ejemplo 2026-11');

const latest = (prefix) => {
  const f = readdirSync(dir)
    .filter((n) => n.startsWith(prefix) && n.endsWith('.xlsx'))
    .sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs)[0];
  if (!f) throw new Error(`Falta el Excel "${prefix}…" en ${dir}`);
  return join(dir, f);
};
const sheet = (file) => Object.values(readXlsx(file))[0];
const withHeader = (rows, first) => asObjects(rows, rows.findIndex((r) => r.some((v) => String(v ?? '').trim() === first)));

const files = { products: latest('Productos'), clients: latest('Clientes'), sales: latest('Ventas'), saleLines: latest('Reporte de Ventas'), cuts: latest('Cortes de Caja') };
const data = {
  products: withHeader(sheet(files.products), 'Nombre del Producto'),
  clients: withHeader(sheet(files.clients), 'Nombre'),
  sales: withHeader(sheet(files.sales), 'Número de venta'),
  saleLines: withHeader(sheet(files.saleLines), 'Número de Venta'),
  cuts: withHeader(sheet(files.cuts), 'Fecha'),
};
for (const [k, f] of Object.entries(files)) console.log(`${k.padEnd(10)} ${data[k].length} filas  ${f.split(/[\\/]/).pop()}`);

const bundle = join(tmpdir(), `pos-import-${process.pid}.cjs`);
await build({
  stdin: {
    resolveDir: root,
    loader: 'ts',
    contents: `
      import initSqlJs from 'sql.js';
      import { readFileSync } from 'node:fs';
      import { Database } from '@/db/database';
      import { ensureBaseData } from '@/repos/bootstrap';
      import { importPulpos } from '@/import/pulpos';
      export async function run(data, month) {
        const SQL = await initSqlJs({ wasmBinary: readFileSync(${JSON.stringify(join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'))}) });
        const db = new Database(new SQL.Database());
        await db.write(ensureBaseData);
        const summary = await db.write((tx) => importPulpos(tx, data, { month }));
        return { summary, bytes: await db.export() };
      }`,
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundle,
  alias: { '@': join(root, 'src') },
  logLevel: 'warning',
});
let result;
try {
  result = await createRequire(import.meta.url)(bundle).run(data, month);
} finally {
  rmSync(bundle, { force: true });
}
const { summary: s, bytes } = result;
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
const out = join(root, 'importar', `pos-desde-pulpos-${stamp}.sqlite`);
writeFileSync(out, bytes);
const money = (c) => `$${(c / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const report = [
  `Importación desde Pulpos (${month}) — ${now.toLocaleString('es-MX')}`,
  `Productos: ${s.products} (stock en 0)`,
  `Clientes: ${s.clients}`,
  `Notas: ${s.sales} por ${money(s.salesTotalCents)} (las del mes y todas las que tienen deuda)`,
  `Notas con deuda: ${s.salesWithDebt} por ${money(s.debtCents)}`,
  `Cortes del mes: ${s.cuts}`,
  '',
  `No importadas (${s.skipped.length}):`,
  ...s.skipped.map((x) => `  - ${x}`),
  '',
  `Avisos (${s.warnings.length}):`,
  ...s.warnings.map((x) => `  - ${x}`),
  '',
  `Respaldo listo: ${out}`,
].join('\n');
writeFileSync(join(root, 'importar', `resumen-importacion-${stamp}.txt`), report);
console.log('\n' + report);
