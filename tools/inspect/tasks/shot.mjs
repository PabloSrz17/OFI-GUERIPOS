// args: <nombre-archivo> [url]  -> guarda reference/pulpos/screenshots/<nombre>.png
import path from 'node:path';
const OUT = path.resolve(import.meta.dirname, '../../../reference/pulpos/screenshots');

export default async ({ page, args }) => {
  const [name, url, mode] = args;
  await page.bringToFront();
  if (mode === 'full') {
    const file = path.join(OUT, `${name}.png`);
    if (url && url !== '-') { await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(1500); }
    // La app hace scroll dentro de <main>; se expande temporalmente para capturar todo.
    const h = await page.evaluate(() => { const m = document.querySelector('main'); return m ? m.scrollHeight + 64 : document.body.scrollHeight; });
    const vp = page.viewportSize() || { width: 1416, height: 808 };
    await page.setViewportSize({ width: vp.width, height: Math.min(h, 6000) });
    await page.waitForTimeout(800);
    await page.screenshot({ path: file });
    await page.setViewportSize(vp);
    return { saved: file, url: page.url(), height: h };
  }
  if (url) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return { saved: file, url: page.url(), title: await page.title() };
};
