import { test, expect, type Page } from '@playwright/test';

const SHOTS = 'docs/stage-7/screenshots';
const DAY = 86_400_000;

type Dev = { __posDev: { seedDemo: () => Promise<number>; seedClients: () => Promise<number>; query: (s: string) => Promise<Record<string, unknown>[]> }; __lastTicket?: string };

const sql = (page: Page, q: string) => page.evaluate((s) => (window as unknown as Dev).__posDev.query(s), q);
const search = (page: Page) => page.getByRole('textbox', { name: 'Buscar productos' });
const checkout = (page: Page) => page.getByRole('dialog', { name: /Cobrar|registrada/ });
const collect = (page: Page) => page.getByRole('dialog', { name: 'Registrar Cobro' });

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

/** Vende un producto a crédito a Daniela Fuentes (plazo predeterminado: 15 días). */
async function creditSale(page: Page, q: string, option: RegExp, total: string) {
  await page.goto('/#/pos');
  await search(page).fill(q);
  await page.getByRole('option', { name: option }).first().click();
  await page.getByRole('button', { name: /^Cobrar \$/ }).click();
  await checkout(page).getByRole('radio', { name: 'A Crédito' }).click();
  await checkout(page).getByRole('button', { name: 'Asignar Cliente' }).click();
  const picker = page.getByRole('dialog', { name: 'Añadir Cliente' });
  await picker.getByLabel('Buscar cliente').fill('fuentes');
  await picker.getByLabel('Buscar cliente').press('Enter');
  await checkout(page).getByRole('radio', { name: 'A Crédito' }).click();
  await checkout(page).getByRole('button', { name: `Vender a Crédito ${total}` }).click();
  await expect(checkout(page).getByText(`${total} a crédito de Daniela Fuentes`)).toBeVisible();
  await checkout(page).getByRole('button', { name: 'Nueva Venta' }).click();
}

async function clientDetail(page: Page) {
  await page.goto('/#/clients');
  await page.getByRole('link', { name: 'Daniela Fuentes' }).click();
  await expect(page.getByRole('heading', { name: 'Daniela Fuentes' })).toBeVisible();
}

test.describe('Cobranza', () => {
  test.describe.configure({ timeout: 90_000 });

  test('deuda vencida, cobro con abono parcial, ticket, estado de cuenta, cancelar, cobro desde la venta y filtro', async ({ page }) => {
    const now = Date.now();
    // La primera venta se hace hace 20 días: su plazo de 15 días ya venció.
    await page.clock.install({ time: new Date(now - 20 * DAY) });
    await open(page);
    await creditSale(page, 'cemento', /Cemento gris 25 kg/, '$220.00'); // N1
    await page.clock.setSystemTime(new Date(now));
    await creditSale(page, 'varilla', /Varilla 3\/8"/, '$145.00'); // N2, vence en 15 días

    await clientDetail(page);
    await expect(page.getByTestId('overdue-strip')).toHaveText('El cliente tiene una deuda vencida de $220');
    const detail = page.getByTestId('debt-detail');
    await expect(detail).toContainText('$365');
    await expect(detail).toContainText('Vencida$220');
    await expect(detail).toContainText('A cobrar en 0 a 7 días$0');
    await expect(detail).toContainText('A cobrar en +7 días$145');
    await page.screenshot({ path: `${SHOTS}/J-client-detail-debt.png` });

    // Registrar Cobro: arranca con toda la deuda; abono de $300 con $500 en efectivo.
    await detail.getByRole('button', { name: 'Registrar Cobro' }).click();
    await expect(collect(page).getByTestId('collect-debt')).toHaveText('$365.00');
    await expect(collect(page).getByLabel('Monto a cobrar')).toHaveValue('365.00');
    await collect(page).getByLabel('Monto a cobrar').fill('400');
    await expect(collect(page).getByText('No puede ser mayor que la deuda ($365.00)')).toBeVisible();
    await expect(collect(page).getByRole('button', { name: /^Cobrar/ })).toBeDisabled();
    await collect(page).getByLabel('Monto a cobrar').fill('300');
    await collect(page).getByLabel(/Efectivo recibido/).fill('500');
    await expect(collect(page).getByText('Cambio: $200.00')).toBeVisible();
    const plan = collect(page).getByRole('list', { name: 'Reparto del cobro' });
    await expect(plan.getByRole('listitem').nth(0)).toContainText('Venta N1$220.00Liquidada');
    await expect(plan.getByRole('listitem').nth(1)).toContainText('Venta N2$80.00Resta $65.00');
    await page.screenshot({ path: `${SHOTS}/P-collect-dialog.png`, animations: 'disabled' });
    // Doble clic: un solo cobro.
    await collect(page).getByRole('button', { name: 'Cobrar $300.00' }).dblclick();
    await expect(collect(page).getByText('Cobro #1 registrado')).toBeVisible();
    await expect(collect(page).getByTestId('collection-change')).toHaveText('Cambio: $200.00');
    await page.screenshot({ path: `${SHOTS}/P-collect-success.png`, animations: 'disabled' });
    await collect(page).getByRole('button', { name: 'Imprimir Ticket' }).click();
    const ticket = await page.evaluate(() => (window as unknown as Dev).__lastTicket ?? '');
    expect(ticket).toContain('COMPROBANTE DE COBRO');
    expect(ticket).toContain('Deuda restante');
    expect(ticket).toContain('$65.00');
    const tp = await page.context().newPage();
    await tp.setContent(ticket);
    await tp.screenshot({ path: `${SHOTS}/P-collection-ticket-80mm.png`, clip: { x: 0, y: 0, width: 320, height: 560 } });
    await tp.close();
    await collect(page).getByRole('button', { name: 'Listo' }).click();
    expect(await sql(page, 'SELECT count(*) n FROM collections')).toEqual([{ n: 1 }]);

    await clientDetail(page);
    await expect(page.getByTestId('overdue-strip')).toHaveCount(0);
    await expect(page.getByTestId('debt-detail')).toContainText('$65');
    await expect(page.getByText('Cobro #1')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/J-client-detail-collections.png`, fullPage: true });

    // Estado de Cuenta.
    await page.getByRole('button', { name: 'Ver Estado de Cuenta' }).click();
    const st = page.getByRole('dialog', { name: 'Estado de Cuenta' });
    await expect(st).toContainText('Ventas con Deuda: 1');
    await expect(st).toContainText('Deuda Pendiente: $65.00');
    await expect(st).toContainText('$65.00 adeudados');
    await page.screenshot({ path: `${SHOTS}/J-client-statement.png`, animations: 'disabled' });
    await st.getByRole('button', { name: 'Cerrar', exact: true }).last().click();

    // La caja recibe el cobro.
    await page.goto('/#/cash');
    await expect(page.getByRole('button', { name: 'Ver desglose de Efectivo' })).toHaveText('$300.00');
    await page.getByRole('button', { name: 'Ver desglose de Efectivo' }).click();
    await expect(page.getByRole('dialog')).toContainText('Cobros de Crédito');
    await page.keyboard.press('Escape');

    // Cancelar el cobro (con confirmación): la deuda vuelve y el dinero sale de la caja.
    await clientDetail(page);
    await page.getByRole('button', { name: 'Acciones del cobro #1' }).click();
    await page.getByRole('menuitem', { name: 'Cancelar Cobro' }).click();
    await page.getByRole('dialog', { name: 'Cancelar cobro' }).getByRole('button', { name: 'Cancelar Cobro' }).click();
    await expect(page.getByText('Cancelado', { exact: true })).toBeVisible();
    await expect(page.getByTestId('debt-detail')).toContainText('$365');
    await expect(page.getByTestId('overdue-strip')).toBeVisible();
    await page.goto('/#/cash');
    await expect(page.getByRole('button', { name: 'Ver desglose de Efectivo' })).toHaveText('$0.00');

    // Desde la venta solo se cobra esa venta.
    await page.goto('/#/sales');
    await page.getByRole('link', { name: 'N2', exact: true }).click();
    await page.getByRole('button', { name: 'Registrar Cobro' }).click();
    await expect(collect(page).getByTestId('collect-debt')).toHaveText('$145.00');
    await collect(page).getByRole('radio', { name: 'Transferencia' }).click();
    await collect(page).getByRole('button', { name: 'Cobrar $145.00' }).click();
    await expect(collect(page).getByText('Cobro #2 registrado')).toBeVisible();
    await collect(page).getByRole('button', { name: 'Listo' }).click();
    await expect(page.getByText('Cobro de $145.00 en Transferencia')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Registrar Cobro' })).toHaveCount(0);

    // Filtro Estado de Deuda.
    await page.goto('/#/clients');
    await page.getByRole('button', { name: /Filtrar/ }).click();
    const f = page.getByRole('dialog', { name: 'Filtros' });
    await f.getByRole('combobox', { name: 'Estado de Deuda' }).click();
    await page.getByRole('option', { name: 'Deuda Vencida' }).click();
    await page.screenshot({ path: `${SHOTS}/J-clients-filter.png`, animations: 'disabled' });
    await f.getByRole('button', { name: 'Ver Resultados' }).click();
    await expect(page.getByRole('link', { name: 'Daniela Fuentes' })).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(2);
    await page.getByRole('button', { name: /Filtrar/ }).click();
    await f.getByRole('combobox', { name: 'Estado de Deuda' }).click();
    await page.getByRole('option', { name: 'Sin deuda' }).click();
    await f.getByRole('button', { name: 'Ver Resultados' }).click();
    await expect(page.getByRole('link', { name: 'Andrea Campos' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Daniela Fuentes' })).toHaveCount(0);
  });
});
