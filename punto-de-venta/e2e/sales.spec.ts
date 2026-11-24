import { test, expect, type Page } from '@playwright/test';

const SHOTS = 'docs/stage-5/screenshots';

type Dev = { __posDev: { seedDemo: () => Promise<number>; seedClients: () => Promise<number>; query: (s: string) => Promise<Record<string, unknown>[]> }; __lastTicket?: string };

const sql = (page: Page, q: string) => page.evaluate((s) => (window as unknown as Dev).__posDev.query(s), q);
const search = (page: Page) => page.getByRole('textbox', { name: 'Buscar productos' });
const checkout = (page: Page) => page.getByRole('dialog', { name: /Cobrar|registrada/ });

async function add(page: Page, q: string, option: RegExp) {
  await search(page).fill(q);
  await page.getByRole('option', { name: option }).first().click();
}

async function finish(page: Page, folio: string) {
  await expect(checkout(page).getByText(`Venta ${folio} registrada`)).toBeVisible();
  await checkout(page).getByRole('button', { name: 'Nueva Venta' }).click();
  await expect(checkout(page)).toBeHidden();
}

/** N1 efectivo (cemento $220) · N2 a crédito a Daniela Fuentes (varilla $145) · N3 débito con entrega posterior (brocha $28). */
async function setup(page: Page) {
  await page.addInitScript(() => Object.assign(window, { __posNoPrint: true, __posNoReminders: true }));
  await page.goto('/#/pos');
  await page.waitForFunction(() => (window as unknown as { __posDev?: unknown }).__posDev);
  await page.evaluate(async () => {
    const d = (window as unknown as Dev).__posDev;
    await d.seedDemo();
    await d.seedClients();
  });
  await page.evaluate(() => document.fonts.ready);

  await add(page, 'cemento', /Cemento gris 25 kg/);
  await page.getByRole('button', { name: /^Cobrar \$/ }).click();
  await checkout(page).getByRole('button', { name: /^Cobrar \$220\.00/ }).click();
  await finish(page, 'N1');

  await add(page, 'varilla', /Varilla 3\/8"/);
  await page.getByRole('button', { name: /^Cobrar \$/ }).click();
  await checkout(page).getByRole('radio', { name: 'A Crédito' }).click();
  await checkout(page).getByRole('button', { name: 'Asignar Cliente' }).click();
  const picker = page.getByRole('dialog', { name: 'Añadir Cliente' });
  await picker.getByLabel('Buscar cliente').fill('fuentes');
  await picker.getByLabel('Buscar cliente').press('Enter');
  await checkout(page).getByRole('radio', { name: 'A Crédito' }).click();
  await checkout(page).getByRole('button', { name: /Vender a Crédito \$145\.00/ }).click();
  await expect(checkout(page).getByText('$145.00 a crédito de Daniela Fuentes')).toBeVisible();
  await checkout(page).getByRole('button', { name: 'Nueva Venta' }).click();
  await expect(checkout(page)).toBeHidden();

  await add(page, 'brocha', /Brocha 2"/);
  await page.getByRole('button', { name: 'Opciones de la venta' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Posponer Entrega de Productos' }).click();
  await page.getByRole('button', { name: /^Cobrar \$/ }).click();
  await checkout(page).getByRole('radio', { name: 'Tarjeta de Débito' }).click();
  await checkout(page).getByRole('button', { name: /^Cobrar \$28\.00/ }).click();
  await finish(page, 'N3');
}

const rows = (page: Page) => page.locator('tbody tr');
const stock = async (page: Page, sku: string) =>
  (await sql(page, `SELECT s.quantity q FROM stock_levels s JOIN products p ON p.id = s.product_id WHERE p.sku = '${sku}'`))[0].q;

test.describe('Historial de ventas', () => {
  test.describe.configure({ timeout: 90_000 });
  test('lista: pestañas, búsqueda, filtros y descarga', async ({ page }) => {
    await setup(page);
    await page.goto('/#/sales');
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).first()).toContainText('N3');
    const credit = page.getByRole('row', { name: /N2/ });
    await expect(credit).toContainText('Daniela Fuentes');
    await expect(credit).toContainText('Deuda pendiente');
    await expect(credit).toContainText('A Crédito');
    await expect(page.getByRole('row', { name: /N3/ })).toContainText('No Entregados');
    await page.screenshot({ path: `${SHOTS}/B-sales-list.png` });

    await page.getByRole('tab', { name: /Pagos Pendientes/ }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('N2');
    await page.getByRole('tab', { name: /No Entregadas/ }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('N3');
    await page.getByRole('tab', { name: 'Todas' }).click();

    // Búsqueda por producto y por cliente.
    await page.getByRole('textbox', { name: 'Buscar ventas' }).fill('cemento');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('N1');
    await page.getByRole('textbox', { name: 'Buscar ventas' }).fill('fuentes');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('N2');
    await page.getByRole('textbox', { name: 'Buscar ventas' }).fill('');
    await expect(rows(page)).toHaveCount(3);

    // Filtros: método + entrega.
    await page.getByRole('button', { name: 'Filtrar' }).click();
    const f = page.getByRole('dialog', { name: 'Filtros' });
    await f.getByRole('combobox', { name: 'Método de Pago' }).click();
    await page.getByRole('option', { name: 'Tarjeta de Débito' }).click();
    await f.getByRole('button', { name: 'No entregadas' }).click();
    await page.screenshot({ path: `${SHOTS}/B-sales-filter.png` });
    await f.getByRole('button', { name: 'Ver Resultados' }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('N3');
    await expect(page).toHaveURL(/method=debit_card/);
    await page.getByRole('button', { name: /Filtrar/ }).click();
    await f.getByRole('button', { name: /Limpiar Filtros/ }).click();
    await f.getByRole('button', { name: 'Ver Resultados' }).click();
    await expect(rows(page)).toHaveCount(3);

    // Excel (.xlsx) del día elegido con el calendario.
    // Edge controlado por Playwright se cierra al descargar: se intercepta el enlace (como en products.spec).
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    const intercept = () =>
      page.evaluate(() => {
        const w = window as unknown as { __dl: Promise<{ name: string; type: string; text: string }> };
        w.__dl = new Promise((resolve) => {
          HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
            fetch(this.href).then((r) => r.blob()).then(async (b) => resolve({ name: this.download, type: b.type, text: new TextDecoder().decode(await b.arrayBuffer()) }));
          };
        });
      });
    const downloaded = () => page.evaluate(() => (window as unknown as { __dl: Promise<{ name: string; type: string; text: string }> }).__dl);
    await expect(page.getByRole('button', { name: 'Fecha del reporte: Hoy' })).toBeVisible();
    await intercept();
    await page.getByRole('button', { name: 'Descargar Ventas' }).click();
    const dl = await downloaded();
    expect(dl.name).toBe(`reporte-ventas-${today}.xlsx`);
    expect(dl.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(dl.text.startsWith('PK')).toBe(true);
    for (const h of ['NUMERO DE VENTA #TICKET', 'CLIENTE', 'ESTADO', 'TOTAL', 'DEUDA ACTIVA', 'Daniela Fuentes', 'Público General', 'Deuda pendiente']) expect(dl.text).toContain(h);
    expect(dl.text).not.toContain('Cajero');

    // Otro día sin ventas: el archivo sale solo con encabezados.
    await page.getByRole('button', { name: 'Fecha del reporte: Hoy' }).click();
    const picker = page.getByRole('dialog', { name: 'Fecha del reporte' });
    await picker.getByRole('radio', { name: 'Rango' }).click();
    await picker.getByLabel('Desde').fill('2026-01-01');
    await picker.getByLabel('Hasta').fill('2026-01-31');
    await page.screenshot({ path: 'docs/stage-5/screenshots/B-sales-report-date.png' });
    await picker.getByRole('button', { name: 'Listo' }).click();
    await intercept();
    await page.getByRole('button', { name: 'Descargar Ventas' }).click();
    const empty = await downloaded();
    expect(empty.name).toBe('reporte-ventas-2026-01-01_al_2026-01-31.xlsx');
    expect(empty.text).toContain('DEUDA ACTIVA');
    expect(empty.text).not.toContain('Daniela Fuentes');
  });

  test('detalle: entrega, comentarios, cliente, nota, reimpresión y eliminación', async ({ page }) => {
    await setup(page);
    const brocha = await stock(page, 'BRO-2');

    // N3: entrega posterior.
    await page.goto('/#/sales');
    await page.getByRole('link', { name: 'N3' }).click();
    await expect(page.getByRole('heading', { name: 'Venta N3' })).toBeVisible();
    await page.getByRole('button', { name: 'Entregar Productos' }).click();
    await page.getByRole('dialog', { name: 'Entregar Productos' }).getByRole('button', { name: 'Entregar' }).click();
    await expect(page.getByRole('button', { name: 'Entregar Productos' })).toBeHidden();
    expect(await stock(page, 'BRO-2')).toBe((brocha as number) - 1);

    await page.getByRole('textbox', { name: 'Añadir un Comentario' }).fill('Lo recogió su hermano');
    await page.getByRole('button', { name: 'Comentar' }).click();
    await expect(page.getByText('Lo recogió su hermano')).toBeVisible();

    await page.getByRole('button', { name: 'Asignar Cliente' }).click();
    const picker = page.getByRole('dialog', { name: 'Añadir Cliente' });
    await picker.getByLabel('Buscar cliente').fill('campos');
    await picker.getByLabel('Buscar cliente').press('Enter');
    await expect(page.getByRole('link', { name: 'Andrea Campos' })).toBeVisible();

    await page.getByRole('button', { name: 'Añadir Nota' }).click();
    const note = page.getByRole('dialog', { name: /Nota/ });
    await note.getByRole('textbox').fill('Factura pendiente');
    await note.getByRole('button', { name: /Guardar|Añadir/ }).click();
    await expect(page.getByText('Factura pendiente')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/B-sale-detail.png`, fullPage: true });

    // Reimpresión.
    await page.getByRole('button', { name: 'Imprimir Ticket' }).click();
    await page.waitForFunction(() => (window as unknown as Dev).__lastTicket);
    expect(await page.evaluate(() => (window as unknown as Dev).__lastTicket!)).toContain('REIMPRESIÓN');

    // N2: crédito con deuda.
    await page.goto('/#/sales');
    await page.getByRole('link', { name: 'N2' }).click();
    await expect(page.getByText('Adeudado')).toBeVisible();
    await expect(page.getByText('Vence en 15 días')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/B-sale-detail-debt.png`, fullPage: true });

    // N1: eliminar regresa stock y dinero.
    const cemento = await stock(page, 'CEM-25');
    await page.goto('/#/sales');
    await page.getByRole('link', { name: 'N1' }).click();
    await page.getByRole('button', { name: 'Más Acciones' }).click();
    await page.screenshot({ path: `${SHOTS}/B-sale-more-actions.png` });
    await page.getByRole('menuitem', { name: 'Eliminar' }).click();
    const del = page.getByRole('dialog', { name: 'Eliminar Venta N1' });
    await expect(del).toContainText('se descontarán $220.00 de la caja');
    await del.getByRole('button', { name: 'Eliminar Venta' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Esta venta fue eliminada' })).toBeVisible();
    expect(await stock(page, 'CEM-25')).toBe((cemento as number) + 1);
    const [r] = await sql(
      page,
      "SELECT (SELECT sum(amount_cents) FROM cash_movements WHERE method = 'cash') cash, (SELECT count(*) FROM inventory_movements WHERE description = 'Eliminación de Venta #1') mov, (SELECT count(*) FROM sales) sales",
    );
    expect(r).toEqual({ cash: 0, mov: 1, sales: 3 });

    // La venta eliminada sale de la lista.
    await page.goto('/#/sales');
    await expect(rows(page)).toHaveCount(2);
  });

  test('preferencias: límite predeterminado, bloqueo por deuda vencida y ticket', async ({ page }) => {
    await setup(page);
    await page.goto('/#/settings/clients');
    await page.getByRole('radio', { name: 'Limitar por monto fijo' }).click();
    await page.getByLabel('Monto predeterminado').fill('100');
    await page.getByLabel('Monto predeterminado').press('Enter');
    await page.getByRole('checkbox', { name: /Restringir vender a crédito/ }).click();
    await expect(page.getByRole('checkbox', { name: /Restringir vender a crédito/ })).toBeChecked();
    await page.screenshot({ path: `${SHOTS}/J-settings-clients.png` });
    const rows2 = await sql(page, "SELECT key, value FROM settings WHERE key IN ('clients.default_credit_limit_cents', 'clients.block_overdue_credit') ORDER BY key");
    expect(rows2).toEqual([
      { key: 'clients.block_overdue_credit', value: 'true' },
      { key: 'clients.default_credit_limit_cents', value: '10000' },
    ]);

    await page.getByRole('link', { name: 'Tickets' }).click();
    await page.getByLabel(/Nombre del negocio/).fill('Ferretería La Prueba');
    await page.getByLabel('RFC').fill('XAXX010101000');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}/J-settings-tickets.png` });

    await page.goto('/#/sales');
    await page.getByRole('link', { name: 'N1' }).click();
    await page.getByRole('button', { name: 'Imprimir Ticket' }).click();
    // El nombre del negocio ya no va en el ticket de venta (D38); el RFC sí.
    await page.waitForFunction(() => (window as unknown as Dev).__lastTicket?.includes('XAXX010101000'));
    expect(await page.evaluate(() => (window as unknown as Dev).__lastTicket!)).not.toContain('La Prueba');
  });
});
