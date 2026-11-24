import { test, expect, type Page } from '@playwright/test';

const SHOTS = 'docs/stage-6/screenshots';

type Dev = { __posDev: { seedDemo: () => Promise<number>; seedClients: () => Promise<number>; query: (s: string) => Promise<Record<string, unknown>[]> }; __lastTicket?: string };

const sql = (page: Page, q: string) => page.evaluate((s) => (window as unknown as Dev).__posDev.query(s), q);
const search = (page: Page) => page.getByRole('textbox', { name: 'Buscar productos' });
const checkout = (page: Page) => page.getByRole('dialog', { name: /Cobrar|registrada/ });

async function open(page: Page) {
  await page.addInitScript(() => Object.assign(window, { __posNoPrint: true, __posNoReminders: true }));
  await page.goto('/#/pos');
  await page.waitForFunction(() => (window as unknown as { __posDev?: unknown }).__posDev);
  await page.evaluate(async () => {
    const d = (window as unknown as Dev).__posDev;
    await d.seedDemo();
    await d.seedClients();
  });
  await page.evaluate(() => document.fonts.ready);
}

/** Vende un producto con el método indicado ('Efectivo' por defecto). */
async function sell(page: Page, q: string, option: RegExp, method?: string) {
  await page.goto('/#/pos');
  await search(page).fill(q);
  await page.getByRole('option', { name: option }).first().click();
  await page.getByRole('button', { name: /^Cobrar \$/ }).click();
  if (method) await checkout(page).getByRole('radio', { name: method }).click();
  await checkout(page).getByRole('button', { name: /^Cobrar \$/ }).click();
  await expect(checkout(page).getByText(/^Venta N\d+ registrada$/)).toBeVisible();
  await checkout(page).getByRole('button', { name: 'Nueva Venta' }).click();
}

async function flow(page: Page, kind: 'Ingresar' | 'Retirar', amount: string, reason: string) {
  await page.getByRole('button', { name: `${kind} Efectivo` }).click();
  const dlg = page.getByRole('dialog', { name: kind === 'Ingresar' ? 'Ingresar Efectivo a Caja' : 'Retirar Efectivo de Caja' });
  await expect(dlg.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  await dlg.getByLabel('Monto').fill(amount);
  await dlg.getByLabel(/Motivo/).fill(reason);
  return dlg;
}

test.describe('Caja y cortes', () => {
  test.describe.configure({ timeout: 90_000 });

  test('caja: total esperado por método, ingresos, retiros y eliminar con confirmación', async ({ page }) => {
    await open(page);
    await sell(page, 'cemento', /Cemento gris 25 kg/); // $220 efectivo
    await sell(page, 'varilla', /Varilla 3\/8"/, 'Tarjeta de Débito'); // $145
    await sell(page, 'brocha', /Brocha 2"/, 'Transferencia'); // $28

    await page.goto('/#/cash');
    await expect(page.getByRole('heading', { name: 'Caja Principal' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ver desglose de Efectivo' })).toHaveText('$220.00');
    await expect(page.getByRole('button', { name: 'Ver desglose de Tarjeta de Débito' })).toHaveText('$145.00');
    await expect(page.getByRole('button', { name: 'Ver desglose de Transferencia' })).toHaveText('$28.00');
    await expect(page.getByTestId('cash-total')).toHaveText('$393.00');

    let dlg = await flow(page, 'Ingresar', '500', 'Reposición de billetes');
    await page.screenshot({ path: `${SHOTS}/G-cash-in-modal.png` });
    await dlg.getByRole('button', { name: 'Confirmar' }).click();
    await expect(dlg).toBeHidden();
    dlg = await flow(page, 'Retirar', '90', 'Pago de luz');
    await page.screenshot({ path: `${SHOTS}/G-cash-out-modal.png` });
    await dlg.getByLabel('Monto').press('Enter');
    await expect(dlg).toBeHidden();
    dlg = await flow(page, 'Retirar', '35', 'Garrafón');
    await dlg.getByRole('button', { name: 'Confirmar' }).click();

    await expect(page.getByTestId('cash-flow')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Ver desglose de Efectivo' })).toHaveText('$595.00');
    await page.screenshot({ path: `${SHOTS}/G-cash-current.png`, fullPage: true });

    // Desglose del efectivo.
    await page.getByRole('button', { name: 'Ver desglose de Efectivo' }).click();
    const exp = page.getByRole('dialog', { name: /Total Esperado/ });
    await expect(exp.getByText('+$220.00')).toBeVisible();
    await expect(exp.getByText('+$500.00')).toBeVisible();
    await expect(exp.getByText('-$125.00')).toBeVisible();
    await expect(exp.getByTestId('expected-total')).toHaveText('$595.00');
    await page.screenshot({ path: `${SHOTS}/G-cash-expected-breakdown.png` });
    await exp.getByRole('radio', { name: 'Detalle de Movimientos' }).click();
    await expect(exp.getByRole('link', { name: 'Venta N1' })).toBeVisible();
    await expect(exp.getByText('Garrafón')).toBeVisible();
    await page.keyboard.press('Escape');

    // Eliminar el retiro del garrafón: se anula, no se borra.
    await page.getByRole('button', { name: 'Eliminar retiro de $35.00' }).click();
    const del = page.getByRole('dialog', { name: 'Eliminar retiro' });
    await expect(del).toContainText('Garrafón');
    await del.getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.getByTestId('cash-flow')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Ver desglose de Efectivo' })).toHaveText('$630.00');
    const [r] = await sql(page, "SELECT (SELECT count(*) FROM cash_movements WHERE type = 'cash_out_void' AND amount_cents = 3500) voids, (SELECT count(*) FROM cash_movements WHERE type = 'cash_out') outs");
    expect(r).toEqual({ voids: 1, outs: 2 });
  });

  test('corte: recuento por método, diferencia, retiro total, ticket e historial', async ({ page }) => {
    await open(page);
    await sell(page, 'cemento', /Cemento gris 25 kg/); // $220 efectivo
    await sell(page, 'varilla', /Varilla 3\/8"/, 'Tarjeta de Crédito'); // $145
    await page.goto('/#/cash');
    const dlg = await flow(page, 'Retirar', '20', 'Bolsas');
    await dlg.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('cash-flow')).toHaveCount(1);

    await page.getByRole('button', { name: 'Hacer Corte de Caja' }).click();
    await expect(page.getByRole('heading', { name: 'Hacer Corte de Caja' })).toBeVisible();
    const cash = page.getByRole('spinbutton', { name: 'Recuento de Efectivo' });
    await expect(cash).toBeFocused();
    await expect(page.getByRole('button', { name: 'Confirmar Corte' })).toBeDisabled();
    // La tarjeta viene llena con lo esperado.
    await expect(page.getByRole('spinbutton', { name: 'Recuento de Tarjeta de Crédito' })).toHaveValue('145.00');
    await cash.fill('195');
    await expect(page.getByTestId('diff-cash')).toHaveText('Faltan $5.00');
    await expect(page.getByTestId('diff-credit_card')).toHaveText('Sin diferencia');
    await expect(page.getByTestId('withdrawn')).toHaveText('$195.00');
    await page.getByLabel(/Comentarios/).fill('Faltó cambio');
    await page.screenshot({ path: `${SHOTS}/P-cash-cut-form.png`, fullPage: true, animations: 'disabled' });

    await page.getByRole('button', { name: 'Confirmar Corte' }).click();
    const conf = page.getByRole('dialog', { name: 'Confirmar corte de caja' });
    await expect(conf).toContainText('Faltan $5.00');
    await expect(conf).toContainText('Se retirarán $195.00');
    await conf.getByRole('button', { name: 'Hacer Corte' }).dblclick();

    // Detalle del corte.
    await expect(page.getByRole('heading', { name: 'Detalle de Corte de Caja' })).toBeVisible();
    await expect(page.getByTestId('cut-difference')).toHaveText('Faltan $5.00');
    await expect(page.getByTestId('withdrawn')).toHaveText('$195.00');
    await expect(page.getByText('Faltó cambio')).toBeVisible();
    await expect(page.getByText('Bolsas')).toBeVisible();
    await page.waitForFunction(() => (window as unknown as Dev).__lastTicket?.includes('CORTE DE CAJA'));
    const ticket = await page.evaluate(() => (window as unknown as Dev).__lastTicket!);
    expect(ticket).toContain('Faltan $5.00');
    expect(ticket).toContain('$195.00');
    await page.screenshot({ path: `${SHOTS}/H-cash-cut-detail.png`, fullPage: true });
    await page.getByRole('button', { name: 'Ver Movimientos' }).click();
    await expect(page.getByRole('dialog', { name: 'Movimientos del Corte' }).getByRole('link', { name: 'Venta N2' })).toBeVisible();
    await page.keyboard.press('Escape');

    const [r] = await sql(page, 'SELECT (SELECT count(*) FROM cash_cuts) cuts, (SELECT count(*) FROM cash_movements WHERE cut_id IS NULL) open, (SELECT withdrawn_cents FROM cash_cuts) w');
    expect(r).toEqual({ cuts: 1, open: 0, w: 19500 });

    // La caja empieza de cero y el retiro ya no se puede eliminar.
    await page.goto('/#/cash');
    await expect(page.getByTestId('cash-total')).toHaveText('$0.00');
    await expect(page.getByTestId('cash-flow')).toHaveCount(0);
    await page.getByRole('button', { name: 'Hacer Corte de Caja' }).click();
    await expect(page.getByText('No hay movimientos desde el último corte')).toBeVisible();

    // Historial.
    await sell(page, 'brocha', /Brocha 2"/);
    await page.goto('/#/cash/cut');
    await page.getByRole('spinbutton', { name: 'Recuento de Efectivo' }).fill('28');
    await page.getByRole('button', { name: 'Confirmar Corte' }).click();
    await page.getByRole('dialog', { name: 'Confirmar corte de caja' }).getByRole('button', { name: 'Hacer Corte' }).click();
    await expect(page.getByTestId('cut-difference')).toHaveText('Sin diferencia');

    await page.goto('/#/cash/history');
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(page.locator('tbody tr').first()).toContainText('Sin diferencia');
    await expect(page.locator('tbody tr').nth(1)).toContainText('Faltan $5.00');
    await expect(page.locator('tbody tr').nth(1)).toContainText('$345.00');
    await page.screenshot({ path: `${SHOTS}/H-cash-history.png` });
    await page.getByRole('button', { name: 'Filtrar' }).click();
    const f = page.getByRole('dialog', { name: 'Filtros' });
    await f.getByRole('button', { name: 'Con diferencia' }).click();
    await f.getByRole('button', { name: 'Ver Resultados' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.getByRole('textbox', { name: 'Buscar cortes' }).fill('cambio');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.getByRole('textbox', { name: 'Buscar cortes' }).fill('nada');
    await expect(page.getByText('No se encontraron cortes')).toBeVisible();
  });
});
