import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Respaldo sin Servidor POS (los datos viven en este navegador, D31). */
const SHOTS = 'docs/stage-9/screenshots';
type Dev = { __posDev: { seedDemo: () => Promise<number>; seedClients: () => Promise<number> } };
type Saved = { __saved: { name: string; b64: string }[] };

const checkout = (page: Page) => page.getByRole('dialog', { name: /Cobrar|registrada/ });
async function sell(page: Page, q: string, option: RegExp) {
  await page.goto('/#/pos');
  await page.getByRole('textbox', { name: 'Buscar productos' }).fill(q);
  await page.getByRole('option', { name: option }).first().click();
  await page.getByRole('button', { name: /^Cobrar \$/ }).click();
  await checkout(page).getByRole('button', { name: /^Cobrar \$/ }).click();
  await expect(checkout(page).getByText(/^Venta N\d+ registrada$/)).toBeVisible();
  await checkout(page).getByRole('button', { name: 'Nueva Venta' }).click();
}

test('respaldo local: aviso, descargar y restaurar', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { __posNoPrint: true });
    const w = window as unknown as Saved;
    w.__saved = [];
    // Las descargas se guardan en memoria para poder restaurarlas después.
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      const name = this.download;
      void fetch(this.href)
        .then((r) => r.arrayBuffer())
        .then((buf) => {
          let s = '';
          for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
          w.__saved.push({ name, b64: btoa(s) });
        });
    };
  });
  await page.goto('/#/pos');
  await page.waitForFunction(() => (window as unknown as { __posDev?: unknown }).__posDev);
  await page.evaluate(async () => {
    const d = (window as unknown as Dev).__posDev;
    await d.seedDemo();
    await d.seedClients();
  });
  await expect(page.getByTestId('connection')).toHaveText('Trabajando localmente');
  await sell(page, 'cemento', /Cemento gris 25 kg/);

  // Con ventas y sin respaldo, aparece el aviso (no en el punto de venta).
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0);
  await page.goto('/#/sales');
  await expect(page.getByTestId('backup-reminder')).toContainText('Todavía no has descargado ningún respaldo');
  await page.getByTestId('backup-reminder').getByRole('button', { name: 'Descargar Respaldo' }).click();
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as Saved).__saved.length)).toBe(1);
  const [backup] = await page.evaluate(() => (window as unknown as Saved).__saved);
  expect(backup.name).toMatch(/^respaldo-pos-.*\.sqlite$/);

  await page.goto('/#/settings/backup');
  await expect(page.getByRole('heading', { name: 'Los datos están en este navegador' })).toBeVisible();
  await expect(page.getByTestId('last-download')).toHaveText(/^Hoy/);
  await page.screenshot({ path: `${SHOTS}/P-backup-local.png` });

  // Una venta más y se restaura el respaldo: la venta N2 desaparece y antes se descarga una copia.
  await sell(page, 'varilla', /Varilla 3\/8"/);
  const file = join(mkdtempSync(join(tmpdir(), 'pos-backup-')), backup.name);
  writeFileSync(file, Buffer.from(backup.b64, 'base64'));
  await page.goto('/#/settings/backup');
  await page.getByLabel('Archivo de respaldo').setInputFiles(file);
  const confirm = page.getByRole('dialog', { name: 'Restaurar respaldo' });
  await expect(confirm).toContainText('1 venta, 27 productos y 10 clientes');
  await confirm.getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByText('Respaldo restaurado. Se descargó una copia de lo anterior.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as Saved).__saved.map((s) => s.name))).toEqual([backup.name, expect.stringMatching(/^antes-de-restaurar-.*\.sqlite$/)]);
  await page.goto('/#/sales');
  await expect(page.getByRole('link', { name: 'N1', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'N2', exact: true })).toHaveCount(0);
  // Sigue el folio del respaldo.
  await sell(page, 'varilla', /Varilla 3\/8"/);
  await page.goto('/#/sales');
  await expect(page.getByRole('link', { name: 'N2', exact: true })).toBeVisible();

  // Un archivo que no es respaldo se rechaza.
  const bad = join(tmpdir(), 'no-es-respaldo.sqlite');
  writeFileSync(bad, 'hola');
  await page.goto('/#/settings/backup');
  await page.getByLabel('Archivo de respaldo').setInputFiles(bad);
  await expect(page.getByRole('dialog', { name: 'Restaurar respaldo' })).toHaveCount(0);
  await expect(page.getByText(/no es un respaldo/i)).toBeVisible();
});
