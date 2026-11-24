// args: <url|-> <nombre del botón> [carpeta destino]
// Pulsa un botón de descarga OFICIAL de Pulpos y guarda el archivo. Si se abre un diálogo en vez de descargar,
// NO confirma nada: devuelve el contenido del diálogo para revisarlo.
import path from 'node:path';
export default async ({ page, args }) => {
  const [url, name, dir = '../../importar/pulpos'] = args;
  if (url && url !== '-') {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await page.getByRole('button', { name, exact: true }).first().click();
  const d = await dl;
  if (!d) {
    const dlg = page.locator('[role=dialog], .modal');
    const txt = (await dlg.count()) ? await dlg.first().ariaSnapshot().catch(() => '') : '';
    return { downloaded: false, dialog: txt, url: page.url() };
  }
  const file = path.resolve(dir, d.suggestedFilename());
  await d.saveAs(file);
  return { downloaded: true, file };
};
