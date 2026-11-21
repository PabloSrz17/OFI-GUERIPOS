// Uso: node run.mjs <tarea.mjs> [args...]
// La tarea exporta: default async ({ page, context, args }) => resultado (se imprime como JSON).
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [task, ...args] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
const pages = context.pages().filter(p => !p.url().startsWith('devtools'));
const page = pages.find(p => p.url().includes('pulpos')) || pages[0];
try {
  const mod = await import(pathToFileURL(path.resolve(task)).href);
  const out = await mod.default({ page, context, args });
  if (out !== undefined) console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
} finally {
  await browser.close().catch(() => {}); // solo desconecta; no cierra la ventana
}
