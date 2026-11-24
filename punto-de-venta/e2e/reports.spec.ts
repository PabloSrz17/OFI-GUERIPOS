import { test, expect, type Page } from '@playwright/test';

const SHOTS = 'docs/stage-8/screenshots';
const DAY = 86_400_000;

type Dev = { __posDev: { seedDemo: () => Promise<number>; seedClients: () => Promise<number>; query: (s: string) => Promise<Record<string, unknown>[]> } };

const search = (page: Page) => page.getByRole('textbox', { name: 'Buscar productos' });
const checkout = (page: Page) => page.getByRole('dialog', { name: /Cobrar|registrada/ });

async function open(page: Page) {
  await page.addInitScript(() => {
    Object.assign(window, { __posNoPrint: true, __posNoReminders: true });
    // Descargas: se captura el CSV sin abrir el diálogo del navegador (Edge se cierra con descargas reales).
    const w = window as unknown as { __downloads: { name: string; text: Promise<string> }[] };
    w.__downloads = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.download) {
        w.__downloads.push({ name: this.download, text: fetch(this.href).then((r) => r.text()) });
        return;
      }
      return orig.call(this);
    };
  });
  await page.goto('/#/pos');
  await page.waitForFunction(() => (window as unknown as { __posDev?: unknown }).__posDev);
  await page.evaluate(async () => {
    const d = (window as unknown as Dev).__posDev;
    await d.seedDemo();
    await d.seedClients();
  });
  await page.evaluate(() => document.fonts.ready);
}

async function sell(page: Page, q: string, option: RegExp, method?: string, credit?: string) {
  await page.goto('/#/pos');
  await search(page).fill(q);
  await page.getByRole('option', { name: option }).first().click();
  await page.getByRole('button', { name: /^Cobrar \$/ }).click();
  if (credit) {
    await checkout(page).getByRole('radio', { name: 'A Crédito' }).click();
    await checkout(page).getByRole('button', { name: 'Asignar Cliente' }).click();
    const picker = page.getByRole('dialog', { name: 'Añadir Cliente' });
    await picker.getByLabel('Buscar cliente').fill(credit);
    await picker.getByLabel('Buscar cliente').press('Enter');
    await checkout(page).getByRole('radio', { name: 'A Crédito' }).click();
    await checkout(page).getByRole('button', { name: /^Vender a Crédito/ }).click();
  } else {
    if (method) await checkout(page).getByRole('radio', { name: method }).click();
    await checkout(page).getByRole('button', { name: /^Cobrar \$/ }).click();
  }
  await expect(checkout(page).getByText(/^Venta N\d+ registrada$/)).toBeVisible();
  await checkout(page).getByRole('button', { name: 'Nueva Venta' }).click();
}

const lastDownload = (page: Page) =>
  page.evaluate(async () => {
    const d = (window as unknown as { __downloads: { name: string; text: Promise<string> }[] }).__downloads.at(-1)!;
    return { name: d.name, text: await d.text };
  });

test.describe('Reportes', () => {
  test.describe.configure({ timeout: 120_000 });

  test('índice, ventas por periodo, productos, métodos, clientes, cuentas por cobrar, movimientos, stock y valor', async ({ page }) => {
    const now = Date.now();
    await page.clock.install({ time: new Date(now - 20 * DAY) });
    await open(page);
    await sell(page, 'cemento', /Cemento gris 25 kg/, undefined, 'fuentes'); // N1 $220 crédito, vencida
    await page.clock.setSystemTime(new Date(now - 3 * DAY));
    await sell(page, 'varilla', /Varilla 3\/8"/, 'Tarjeta de Débito'); // N2 $145
    await page.clock.setSystemTime(new Date(now));
    await sell(page, 'cemento', /Cemento gris 25 kg/); // N3 $220 efectivo
    await sell(page, 'brocha', /Brocha 2"/, 'Transferencia'); // N4 $28
    await sell(page, 'varilla', /Varilla 3\/8"/, undefined, 'campos'); // N5 $145 crédito

    // Un retiro de caja para Movimientos de Dinero.
    await page.goto('/#/cash');
    await page.getByRole('button', { name: 'Retirar Efectivo' }).click();
    const out = page.getByRole('dialog', { name: 'Retirar Efectivo de Caja' });
    await out.getByLabel('Monto').fill('50');
    await out.getByLabel(/Motivo/).fill('Pago de luz');
    await out.getByRole('button', { name: 'Confirmar' }).click();
    await expect(out).toBeHidden();
    await expect(page.getByText('Retiro registrado')).toBeHidden({ timeout: 10_000 });

    // Índice (últimos 7 días: N2–N5).
    await page.goto('/#/reports');
    await expect(page.getByTestId('kpi-count')).toHaveText('4');
    await expect(page.getByTestId('kpi-total')).toHaveText('$538');
    await page.screenshot({ path: `${SHOTS}/I-reports-index.png` });
    await page.getByRole('heading', { name: 'Inventario', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/I-reports-index-bottom.png` });
    await page.getByRole('heading', { name: 'Reportes', exact: true }).scrollIntoViewIfNeeded();

    // Reporte de Ventas: Total y un renglón por día; con 30 días entra la venta vencida.
    await page.getByRole('link', { name: 'Ver reporte' }).first().click();
    await expect(page.getByRole('heading', { name: 'Reporte de Ventas' })).toBeVisible();
    await expect(page.getByTestId('report-headline')).toHaveText('4');
    const total = page.getByRole('row', { name: /^Total/ });
    await expect(total).toContainText('4$538.00');
    await expect(page.getByRole('row')).toHaveCount(9); // encabezado + Total + 7 días
    await page.screenshot({ path: `${SHOTS}/I-report-sales-by-period.png` });
    await page.getByRole('combobox', { name: 'Periodo' }).click();
    await page.getByRole('option', { name: 'Últimos 30 días' }).click();
    await expect(page.getByTestId('report-headline')).toHaveText('5');
    await page.getByRole('combobox', { name: 'Agrupar por día o mes' }).click();
    await page.getByRole('option', { name: 'Por Mes' }).click();
    await expect(page.getByRole('row', { name: /^Total/ })).toContainText('5$758.00');
    await page.getByRole('combobox', { name: 'Métrica' }).click();
    await page.getByRole('option', { name: 'Facturación' }).click();
    await expect(page.getByTestId('report-headline')).toHaveText('$758');
    await page.getByRole('button', { name: 'Descargar Reporte' }).click();
    const csv = await lastDownload(page);
    expect(csv.name).toBe('reporte-de-ventas.csv');
    expect(csv.text).toContain('Total,5,758.00,');

    // Agrupado por Producto conserva el periodo.
    await page.getByRole('combobox', { name: 'Agrupación' }).click();
    await page.getByRole('option', { name: 'Agrupado por Producto' }).click();
    await expect(page.getByRole('heading', { name: 'Productos más Vendidos' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Periodo' })).toHaveText(/Últimos 30 días/);
    const rows = page.getByRole('row');
    await expect(rows.nth(2)).toContainText('Cemento gris 25 kg');
    await expect(rows.nth(2)).toContainText('$440.00');
    await page.screenshot({ path: `${SHOTS}/I-report-products.png` });

    await page.getByRole('combobox', { name: 'Agrupación' }).click();
    await page.getByRole('option', { name: 'Agrupado por Método de Pago' }).click();
    await expect(page.getByRole('row', { name: /^A Crédito/ })).toContainText('2$365.00');
    await expect(page.getByRole('row', { name: /^Efectivo/ })).toContainText('1$220.00');
    await page.screenshot({ path: `${SHOTS}/I-report-payment-methods.png` });

    await page.getByRole('combobox', { name: 'Agrupación' }).click();
    await page.getByRole('option', { name: 'Agrupado por Cliente' }).click();
    await expect(page.getByRole('row', { name: /^Daniela Fuentes/ })).toContainText('1$220.00');
    await expect(page.getByRole('row', { name: /^Público en General/ })).toContainText('3$393.00');
    await page.screenshot({ path: `${SHOTS}/I-report-clients.png` });

    // Cuentas por Cobrar.
    await page.goto('/#/reports/receivables');
    await expect(page.getByTestId('receivables-total')).toHaveText('$365');
    await expect(page.getByRole('row', { name: /^Daniela Fuentes/ })).toContainText('$220.00$220.00');
    await expect(page.getByRole('row', { name: /^Andrea Campos/ })).toContainText('$145.00$0.00$0.00$145.00');
    await page.screenshot({ path: `${SHOTS}/I-report-receivables.png` });

    // Movimientos de Dinero: ventas pagadas y el retiro; las de crédito no mueven dinero.
    await page.goto('/#/reports/transactions');
    await expect(page.getByTestId('money-net')).toHaveText('$343.00');
    await expect(page.getByRole('link', { name: 'Venta N3' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/I-report-money-movements.png` });
    await page.getByRole('radio', { name: 'Salidas' }).click();
    await expect(page.getByRole('row')).toHaveCount(2);
    await expect(page.getByRole('row').nth(1)).toContainText('Retiro de Efectivo · Pago de luz');
    await page.getByRole('radio', { name: 'Todos' }).click();
    await page.getByLabel('Buscar movimiento').fill('n4');
    await expect(page.getByRole('row')).toHaveCount(2);
    await expect(page.getByRole('row').nth(1)).toContainText('Transferencia');

    // Inventario.
    await page.goto('/#/reports/stock');
    await expect(page.getByRole('heading', { name: 'Stock de Productos' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/I-report-stock.png` });
    await page.getByLabel('Buscar producto').fill('cemento gris');
    await expect(page.getByRole('row', { name: /Cemento gris 25 kg/ })).toBeVisible();
    await page.goto('/#/reports/inventory');
    await expect(page.getByTestId('inventory-value')).not.toHaveText('$0');
    await page.screenshot({ path: `${SHOTS}/I-report-inventory.png` });
    await page.getByRole('button', { name: 'Descargar Reporte' }).click();
    expect((await lastDownload(page)).text.split('\n')[0]).toBe('Categoría,Productos,Unidades,Valor,Costo,Margen');
  });
});
