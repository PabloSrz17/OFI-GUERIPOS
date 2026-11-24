// args: <nombre del botón dentro del diálogo abierto> [radio a marcar antes, p. ej. ALL] [carpeta]  -> confirma SOLO una descarga y guarda el archivo.
import path from 'node:path';
export default async ({ page, args }) => {
  const [name, radio, dir = '../../importar/pulpos'] = args;
  const dlg = page.locator('[role=dialog]').first();
  if (radio && radio !== '-') await dlg.locator(`input[type=radio][value="${radio}"]`).check({ force: true });
  const dl = page.waitForEvent('download', { timeout: 120000 }).catch(() => null);
  await dlg.getByRole('button', { name, exact: true }).click();
  const d = await dl;
  if (!d) return { downloaded: false, page: await page.locator('body').innerText().then((t) => t.slice(0, 800)) };
  const file = path.resolve(dir, d.suggestedFilename());
  await d.saveAs(file);
  return { downloaded: true, file };
};
