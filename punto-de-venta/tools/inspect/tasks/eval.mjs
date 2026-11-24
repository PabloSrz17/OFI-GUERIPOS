// args: <archivo.js> [url]  -> evalúa el JS (expresión de función) en la página, solo lectura.
import fs from 'node:fs';
export default async ({ page, args }) => {
  const [file, url] = args;
  if (url) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  const src = fs.readFileSync(file, 'utf8');
  return await page.evaluate(`(${src})()`);
};
