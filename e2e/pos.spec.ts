import { test, expect, type Page } from '@playwright/test';

const SHOTS = 'docs/stage-5/screenshots';

type Dev = { __posDev: { seedDemo: () => Promise<number>; seedClients: () => Promise<number>; query: (s: string) => Promise<Record<string, unknown>[]> }; __lastTicket?: string };

async function open(page: Page, hash = '/pos') {
  await page.addInitScript(() => ((window as unknown as { __posNoPrint: boolean }).__posNoPrint = true));
  await page.goto(`/#${hash}`);
  await page.waitForFunction(() => (window as unknown as { __posDev?: unknown }).__posDev);
  await page.evaluate(async () => {
    const d = (window as unknown as Dev).__posDev;
    await d.seedDemo();
    await d.seedClients();
  });
  await page.evaluate(() => document.fonts.ready);
}

const sql = (page: Page, q: string) => page.evaluate((s) => (window as unknown as Dev).__posDev.query(s), q);
const search = (page: Page) => page.getByRole('textbox', { name: 'Buscar productos' });
const cobrar = (page: Page) => page.getByRole('button', { name: /^Cobrar \$/ });
const checkout = (page: Page) => page.getByRole('dialog', { name: /Cobrar|registrada/ });

async function addByName(page: Page, q: string, option: string | RegExp) {
  await search(page).fill(q);
  await page.getByRole('option', { name: option }).first().click();
}

test.describe('Punto de venta', () => {
  test('venta en efectivo con descuento y cambio: registra venta, stock y caja', async ({ page }) => {
    await open(page);
    await search(page).fill('abrazadera');
    await expect(page.getByRole('option', { name: /Abrazadera de uña 2"/ })).toContainText('12 unidades');
    await expect(page.getByRole('option', { name: /Abrazadera sin fin/ })).toContainText('0 unidades');
    await page.screenshot({ path: `${SHOTS}/C-pos-search-results.png` });
    // Enter agrega el resultado resaltado.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(search(page)).toHaveValue('');
    await expect(page.getByTestId('cart-line')).toHaveCount(1);

    await addByName(page, 'cemento', /Cemento gris 25 kg/);
    await page.getByRole('spinbutton', { name: 'Cantidad de Cemento gris 25 kg' }).fill('2');
    await page.screenshot({ path: `${SHOTS}/C-pos-cart-1-item.png` });

    // Descuento de 10 % al cemento.
    await page.getByRole('button', { name: 'Opciones de Cemento gris 25 kg' }).click();
    await page.screenshot({ path: `${SHOTS}/C-pos-line-menu.png` });
    await page.getByRole('menuitem', { name: 'Añadir Descuento' }).click();
    const disc = page.getByRole('dialog', { name: 'Añadir Descuento' });
    await expect(disc.getByRole('button', { name: 'Añadir' })).toBeDisabled();
    await disc.getByRole('radio', { name: 'Porcentaje (%)' }).click();
    await disc.getByLabel('Cantidad del Descuento').fill('10');
    await disc.getByLabel('Título del Descuento (opcional)').fill('Promo10');
    await page.screenshot({ path: `${SHOTS}/C-pos-line-discount.png` });
    await disc.getByRole('button', { name: 'Añadir' }).click();
    await expect(page.getByText('Descuento Promo10: -$44.00 (10%)')).toBeVisible();
    // 2 × 220 − 44 + 12.45 (↓ eligió el segundo resultado: abrazadera de uña 3") = 408.45
    await expect(cobrar(page)).toHaveText(/Cobrar \$408\.45/);

    await page.keyboard.press('Control+Enter');
    const dlg = checkout(page);
    await expect(dlg.getByTestId('checkout-total')).toHaveText('$408.45');
    await expect(dlg.getByLabel('Efectivo recibido')).toBeFocused();
    await dlg.getByLabel('Efectivo recibido').fill('500');
    await expect(dlg.getByText('$91.55')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/P-checkout-cash.png` });
    await dlg.getByLabel('Efectivo recibido').press('Enter');
    await expect(dlg.getByText('Venta N1 registrada')).toBeVisible();
    await expect(dlg.getByTestId('change')).toHaveText('$91.55');
    await page.screenshot({ path: `${SHOTS}/P-checkout-success.png` });

    // Ticket de 80 mm.
    await dlg.getByRole('button', { name: 'Imprimir Ticket' }).click();
    await page.waitForFunction(() => (window as unknown as Dev).__lastTicket);
    const ticket = await page.evaluate(() => (window as unknown as Dev).__lastTicket!);
    expect(ticket).toContain('size: 80mm auto');
    expect(ticket).toContain('Descuento Promo10');
    expect(ticket).toContain('$91.55');
    await page.setContent(ticket);
    await page.setViewportSize({ width: 340, height: 700 });
    await page.screenshot({ path: `${SHOTS}/P-ticket-80mm.png`, fullPage: true });
    await page.goBack();
  });

  test('el registro queda completo y la venta no se duplica', async ({ page }) => {
    await open(page);
    await addByName(page, 'cemento', /Cemento gris 25 kg/);
    await cobrar(page).click();
    await checkout(page).getByRole('radio', { name: 'Tarjeta de Débito' }).click();
    // Doble clic rápido en Cobrar: una sola venta.
    await checkout(page).getByRole('button', { name: /^Cobrar \$220\.00/ }).dblclick();
    await expect(checkout(page).getByText('Venta N1 registrada')).toBeVisible();
    await checkout(page).getByRole('button', { name: 'Nueva Venta' }).click();
    await expect(checkout(page)).toBeHidden();
    await expect(page.getByText('Tu carrito está vacío')).toBeVisible();
    await expect(search(page)).toBeFocused();

    const [r] = await sql(
      page,
      `SELECT (SELECT count(*) FROM sales) sales, (SELECT count(*) FROM sale_items) items, (SELECT count(*) FROM payments WHERE method = 'debit_card') pays,
              (SELECT count(*) FROM cash_movements WHERE amount_cents = 22000) cash, (SELECT quantity FROM stock_levels s JOIN products p ON p.id = s.product_id WHERE p.sku = 'CEM-25') stock,
              (SELECT count(*) FROM inventory_movements WHERE description = 'Entrega de Venta #1') mov`,
    );
    expect(r).toEqual({ sales: 1, items: 1, pays: 1, cash: 1, stock: 32, mov: 1 });
  });

  test('crédito: exige cliente, se asigna desde el cobro y genera deuda', async ({ page }) => {
    await open(page);
    await addByName(page, 'varilla', /Varilla 3\/8"/);
    await cobrar(page).click();
    await checkout(page).getByRole('radio', { name: 'A Crédito' }).click();
    await expect(checkout(page).getByText('Para vender a crédito asigna un cliente a la venta.')).toBeVisible();
    await expect(checkout(page).getByRole('button', { name: /Vender a Crédito/ })).toBeDisabled();
    await checkout(page).getByRole('button', { name: 'Asignar Cliente' }).click();

    const picker = page.getByRole('dialog', { name: 'Añadir Cliente' });
    await expect(picker.getByRole('option', { name: 'Público en General' })).toBeVisible();
    await picker.getByLabel('Buscar cliente').fill('fuentes');
    await page.screenshot({ path: `${SHOTS}/C-pos-add-client.png` });
    await picker.getByLabel('Buscar cliente').press('Enter');

    // Regresa al cobro con el cliente.
    await expect(checkout(page).getByText('Daniela Fuentes').first()).toBeVisible();
    await checkout(page).getByRole('radio', { name: 'A Crédito' }).click();
    await expect(checkout(page).getByText('Sin limitar')).toBeVisible();
    await expect(checkout(page).getByText('En 15 días')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/P-checkout-credit.png` });
    await checkout(page).getByRole('button', { name: /Vender a Crédito \$145\.00/ }).click();
    await expect(checkout(page).getByText('$145.00 a crédito de Daniela Fuentes')).toBeVisible();
    await checkout(page).getByRole('button', { name: 'Nueva Venta' }).click();

    const [r] = await sql(page, "SELECT s.credit_cents, s.due_date IS NOT NULL due, (SELECT count(*) FROM cash_movements) cash FROM sales s JOIN clients c ON c.id = s.client_id WHERE c.last_name = 'Fuentes'");
    expect(r).toEqual({ credit_cents: 14500, due: 1, cash: 0 });

    // El detalle del cliente ya muestra la venta y la deuda.
    await page.goto('/#/clients');
    await expect(page.getByRole('row', { name: /Daniela Fuentes/ }).getByText('$145.00')).toBeVisible();
  });

  test('límite de crédito: no deja vender más de lo disponible', async ({ page }) => {
    await open(page);
    // Límite de $100 a Bruno (desde su detalle).
    await page.goto('/#/clients');
    await page.getByRole('link', { name: 'Bruno Díaz' }).click();
    await page.getByRole('button', { name: 'Editar Límite de Crédito' }).click();
    await page.getByRole('radio', { name: 'Personalizar límite para este cliente' }).check();
    await page.getByLabel('Monto del límite').fill('100');
    await page.getByRole('button', { name: 'Guardar' }).click();
    // Nueva Venta desde el cliente.
    await page.getByRole('button', { name: 'Más Acciones' }).click();
    await page.getByRole('menuitem', { name: 'Nueva Venta' }).click();
    await expect(page.getByRole('tab', { name: 'Bruno Díaz' })).toBeVisible();
    await addByName(page, 'cemento', /Cemento gris 25 kg/);
    await cobrar(page).click();
    await checkout(page).getByRole('radio', { name: 'A Crédito' }).click();
    await expect(checkout(page).getByText('La venta excede el crédito disponible del cliente.')).toBeVisible();
    await expect(checkout(page).getByRole('button', { name: /Vender a Crédito/ })).toBeDisabled();
  });

  test('precios: lista del carrito, precio personalizado, entrada manual, nota y quitar impuestos', async ({ page }) => {
    await open(page);
    await addByName(page, 'cemento', /Cemento gris 25 kg/);

    // Cambiar precio → personalizado.
    await page.getByRole('button', { name: 'Opciones de Cemento gris 25 kg' }).click();
    await page.getByRole('menuitem', { name: 'Cambiar Precio' }).click();
    const price = page.getByRole('dialog', { name: 'Elige la Lista de Precios' });
    await expect(price.getByRole('button', { name: /Público \$220\.00/ })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/C-pos-line-price.png` });
    await price.getByRole('button', { name: 'Precio Personalizado' }).click();
    await price.getByLabel('Precio Personalizado').fill('200');
    await price.getByRole('button', { name: 'Aplicar Precio' }).click();
    await expect(page.getByTestId('cart-line').getByText('Personalizado')).toBeVisible();

    // Entrada manual sin impuestos.
    await page.keyboard.press('Control+Shift+M');
    const manual = page.getByRole('dialog', { name: 'Entrada Manual de Producto' });
    await expect(manual.getByRole('button', { name: 'Crear y Agregar' })).toBeDisabled();
    await manual.getByLabel('Nombre del producto').fill('Corte de varilla');
    await manual.getByLabel('Cantidad').fill('2');
    await manual.getByLabel('Precio de Venta').fill('11.60');
    await page.screenshot({ path: `${SHOTS}/C-pos-manual-entry.png` });
    await manual.getByRole('button', { name: 'Crear y Agregar' }).click();
    await expect(page.getByTestId('cart-line')).toHaveCount(2);
    await expect(page.getByTestId('cart-line').getByText('Entrada manual')).toBeVisible();

    // Nota.
    await page.keyboard.press('Control+Shift+L');
    await page.getByRole('dialog', { name: 'Añadir Nota' }).getByLabel('Nota').fill('Entregar en obra');
    await page.screenshot({ path: `${SHOTS}/C-pos-add-note.png` });
    await page.getByRole('dialog', { name: 'Añadir Nota' }).getByRole('button', { name: 'Añadir' }).click();
    await expect(page.getByRole('button', { name: 'Entregar en obra' })).toBeVisible();

    // 200 + 2 × 11.60 = 223.20; sin impuestos: 200/1.16 + 23.20/1.16 = 172.41 + 20.00 = 192.41
    await expect(cobrar(page)).toHaveText(/Cobrar \$223\.20/);
    await page.getByRole('button', { name: 'Opciones de la venta' }).click();
    await page.screenshot({ path: `${SHOTS}/C-pos-cart-menu.png` });
    await page.getByRole('menuitemcheckbox', { name: 'Quitar Impuestos de la Venta' }).click();
    await expect(page.getByText('Sin impuestos')).toBeVisible();
    await expect(cobrar(page)).toHaveText(/Cobrar \$192\.41/);
    await expect(page.getByText('Impuestos removidos')).toBeVisible();

    await cobrar(page).click();
    await checkout(page).getByRole('radio', { name: 'Transferencia' }).click();
    await checkout(page).getByRole('button', { name: /^Cobrar \$192\.41/ }).click();
    await expect(checkout(page).getByText('Venta N1 registrada')).toBeVisible();
    const [s] = await sql(page, "SELECT total_cents, taxes_removed, tax_cents, note, (SELECT count(*) FROM sale_items WHERE product_id IS NULL) manual FROM sales");
    expect(s).toEqual({ total_cents: 19241, taxes_removed: 1, tax_cents: 0, note: 'Entregar en obra', manual: 1 });
  });

  test('ventas en paralelo: pestañas que sobreviven a recargar', async ({ page }) => {
    await open(page);
    await addByName(page, 'cemento', /Cemento gris 25 kg/);
    await page.getByRole('button', { name: 'Nueva venta en paralelo' }).click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    await expect(page.getByText('Tu carrito está vacío')).toBeVisible();
    await addByName(page, 'foco', /Foco LED 9W/);
    await addByName(page, 'foco', /Foco LED 9W/);
    await expect(page.getByRole('spinbutton', { name: 'Cantidad de Foco LED 9W' })).toHaveValue('2');
    await page.screenshot({ path: `${SHOTS}/P-parallel-sales.png` });

    await page.reload();
    await expect(page.getByRole('tab')).toHaveCount(2);
    await page.getByRole('tab').first().click();
    await expect(page.getByTestId('cart-line')).toContainText('Cemento gris 25 kg');

    // Cerrar una pestaña con productos pide confirmación.
    await page.getByRole('button', { name: 'Cerrar Nueva Venta' }).first().click();
    await page.getByRole('dialog', { name: 'Cerrar venta en curso' }).getByRole('button', { name: 'Cerrar Venta' }).click();
    await expect(page.getByRole('tab')).toHaveCount(1);
    await expect(page.getByTestId('cart-line')).toContainText('Foco LED 9W');
  });

  test('pedido y entrega posterior: el stock no baja hasta entregar', async ({ page }) => {
    await open(page);
    await page.getByRole('radio', { name: 'Pedido' }).click();
    await expect(page.getByText('Crea un pedido para envío o retiro posterior')).toBeVisible();
    await addByName(page, 'brocha', /Brocha 2"/);
    await expect(page.getByRole('button', { name: /Crear Pedido - \$28\.00/ })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/C-pos-mode-pedido.png` });
    await page.getByRole('button', { name: /Crear Pedido/ }).click();
    await expect(page.getByRole('dialog', { name: 'Cobrar Pedido' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Cobrar Pedido' }).getByRole('button', { name: /^Cobrar \$28\.00/ }).click();
    await expect(page.getByText('Pedido N1 registrada')).toBeVisible();
    await page.getByRole('button', { name: 'Nueva Venta' }).click();

    // Venta normal con "Posponer Entrega".
    await page.getByRole('radio', { name: 'Venta' }).click();
    await addByName(page, 'brocha', /Brocha 2"/);
    await page.getByRole('button', { name: 'Opciones de la venta' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Posponer Entrega de Productos' }).click();
    await expect(page.getByText('Entrega posterior')).toBeVisible();
    await cobrar(page).click();
    await checkout(page).getByRole('button', { name: /^Cobrar \$28\.00/ }).click();
    await expect(checkout(page).getByText('Venta N2 registrada')).toBeVisible();

    const [r] = await sql(page, "SELECT (SELECT quantity FROM stock_levels s JOIN products p ON p.id = s.product_id WHERE p.sku = 'BRO-2') stock, (SELECT count(*) FROM sales WHERE delivery_status = 'pending') pending");
    expect(r).toEqual({ stock: 18, pending: 2 });
  });

  test('lector de códigos: el código exacto + Enter agrega el producto', async ({ page }) => {
    await open(page);
    await page.goto('/#/products');
    await page.getByRole('link', { name: 'Pegamento PVC 250 ml' }).click();
    await page.getByRole('link', { name: /Editar/ }).or(page.getByRole('button', { name: /Editar/ })).first().click();
    await page.getByLabel('Código de barras').fill('7501234500017');
    await page.getByRole('button', { name: 'Guardar Cambios' }).click();
    await page.goto('/#/pos');
    await search(page).fill('7501234500017');
    await search(page).press('Enter');
    await expect(page.getByTestId('cart-line')).toContainText('Pegamento PVC 250 ml');
    await search(page).fill('7501234500017');
    await search(page).press('Enter');
    await expect(page.getByRole('spinbutton', { name: 'Cantidad de Pegamento PVC 250 ml' })).toHaveValue('2');
  });
});
