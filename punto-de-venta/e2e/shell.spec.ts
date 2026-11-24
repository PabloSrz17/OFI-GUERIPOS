import { test, expect, type Page, type Locator } from '@playwright/test';

const SHOTS = 'docs/stage-2/screenshots';

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('sin caja');
  return b;
}

async function css(l: Locator, prop: string) {
  return l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
}

async function go(page: Page, hash: string) {
  await page.goto(`/#${hash}`);
  await page.evaluate(() => document.fonts.ready);
}

test.describe('Esqueleto (navigation.md)', () => {
  test('medidas del aside, header y main coinciden con Pulpos', async ({ page }) => {
    await go(page, '/');
    const aside = page.getByTestId('sidebar');
    const header = page.getByTestId('header');
    expect((await box(aside)).width).toBe(240);
    expect(await css(aside, 'background-color')).toBe('rgb(31, 41, 55)');
    expect((await box(header)).height).toBe(64);
    expect(await css(header, 'border-bottom-color')).toBe('rgb(229, 231, 235)');
    expect(await css(page.getByTestId('main'), 'background-color')).toBe('rgb(243, 244, 246)');
    expect(await css(page.locator('body'), 'font-family')).toContain('Inter');
    // Posiciones verticales del aside de Pulpos: "Nueva Venta" en y=100 e "Inicio" en y=168.
    expect((await box(aside.getByRole('link', { name: 'Nueva Venta' }))).y).toBe(100);
    expect((await box(aside.getByRole('link', { name: 'Inicio' }))).y).toBe(168);
  });

  test('ítem activo: fondo gray-900, texto teal claro y barra indicadora', async ({ page }) => {
    await go(page, '/');
    const inicio = page.getByRole('link', { name: 'Inicio' });
    expect(await css(inicio, 'background-color')).toBe('rgb(17, 24, 39)');
    expect(await css(inicio, 'color')).toBe('rgb(85, 194, 201)');
    expect((await box(inicio)).height).toBe(32);
    const bar = inicio.locator('span[aria-hidden="true"]').first();
    const b = await box(bar);
    expect(b.x).toBe(0);
    expect(b.width).toBe(4);
  });

  test('acordeón: solo un grupo abierto a la vez', async ({ page }) => {
    await go(page, '/');
    const productos = page.getByRole('button', { name: 'Productos' });
    const ventas = page.getByRole('button', { name: 'Ventas' });
    await productos.click();
    await expect(productos).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('link', { name: 'Productos', exact: true })).toBeVisible();
    await ventas.click();
    await expect(ventas).toHaveAttribute('aria-expanded', 'true');
    await expect(productos).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('link', { name: 'Productos', exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/nav-sidebar-expanded.png` });
  });

  test('al navegar se abre el grupo de la página actual y se marca la hoja más específica', async ({ page }) => {
    await go(page, '/cash/history');
    await expect(page.getByRole('button', { name: 'Ventas' })).toHaveAttribute('aria-expanded', 'true');
    const cortes = page.getByRole('link', { name: 'Cortes Históricos' });
    const caja = page.getByRole('link', { name: 'Caja', exact: true });
    expect(await css(cortes, 'background-color')).toBe('rgb(17, 24, 39)');
    expect(await css(caja, 'background-color')).not.toBe('rgb(17, 24, 39)');
  });

  test('en el POS el aside se colapsa a 60px', async ({ page }) => {
    await go(page, '/pos');
    const aside = page.getByTestId('sidebar');
    await expect(aside).toHaveAttribute('data-collapsed', 'true');
    expect((await box(aside)).width).toBe(60);
    const more = page.getByRole('button', { name: 'Opciones de la venta' });
    expect((await box(more)).width).toBe(38);
    await page.screenshot({ path: `${SHOTS}/C-pos-empty.png` });
  });

  test('ruta desconocida muestra 404', async ({ page }) => {
    await go(page, '/no-existe');
    await expect(page.getByRole('heading', { name: 'Página no encontrada' })).toBeVisible();
  });
});

test.describe('Pantallas reconstruidas', () => {
  test('dashboard', async ({ page }) => {
    await go(page, '/');
    await expect(page.getByRole('heading', { name: '¡Hola!' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/A-dashboard.png` });
  });

  test('POS: botón Cobrar deshabilitado con carrito vacío y modo Pedido', async ({ page }) => {
    await go(page, '/pos');
    await expect(page.getByRole('button', { name: 'Cobrar $0.00' })).toBeDisabled();
    await page.getByRole('radio', { name: 'Pedido' }).click();
    await expect(page.getByRole('button', { name: 'Crear Pedido - $0.00' })).toBeVisible();
    await expect(page.getByText('Crea un pedido para envío o retiro posterior')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/C-pos-mode-pedido.png` });
  });
});

test.describe('Catálogo de componentes (/design)', () => {
  test('botón primario y estado deshabilitado', async ({ page }) => {
    await go(page, '/design');
    const primary = page.getByRole('button', { name: 'Primario' });
    expect(await css(primary, 'background-color')).toBe('rgb(0, 164, 174)');
    expect((await box(primary)).height).toBe(38);
    expect(await css(primary, 'border-radius')).toBe('6px');
    const disabled = page.getByRole('button', { name: 'Deshabilitado' });
    expect(await css(disabled, 'background-color')).toBe('rgb(243, 244, 246)');
    expect(await css(disabled, 'color')).toBe('rgb(107, 114, 128)');
  });

  test('patrón de lista', async ({ page }) => {
    await go(page, '/design');
    const section = page.locator('#patron-lista');
    await section.scrollIntoViewIfNeeded();
    const pill = section.getByText('0 unidades').first();
    expect(await css(pill, 'background-color')).toBe('rgb(254, 226, 226)');
    expect(await css(pill, 'color')).toBe('rgb(153, 27, 27)');
    await expect(section.getByText('-4 unidades')).toBeVisible();
    await section.screenshot({ path: `${SHOTS}/D-products-list-pattern.png` });
  });

  test('menú Agregar Producto', async ({ page }) => {
    await go(page, '/design');
    const section = page.locator('#patron-lista');
    await section.getByRole('button', { name: 'Agregar Producto' }).click();
    await expect(page.getByRole('menuitem', { name: /Nuevo Kit de Productos/ })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/D-products-add-menu.png` });
    await page.keyboard.press('Escape');
  });

  test('modal Crear Producto Rápido: el botón se habilita al escribir el nombre', async ({ page }) => {
    await go(page, '/design');
    await page.getByRole('button', { name: 'Abrir "Crear Producto Rápido"' }).click();
    const dialog = page.getByRole('dialog', { name: 'Crear Producto Rápido' });
    await expect(dialog).toBeVisible();
    const create = dialog.getByRole('button', { name: 'Crear Producto' });
    await expect(create).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}/D-product-new-form.png` });
    await dialog.getByPlaceholder('Ej: Jabón de mano').fill('Prueba');
    await expect(create).toBeEnabled();
    // toHaveCSS reintenta: el botón tiene transición de color al habilitarse.
    await expect(create).toHaveCSS('background-color', 'rgb(0, 164, 174)');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('modal Filtros: contador de filtros activos y limpiar', async ({ page }) => {
    await go(page, '/design');
    await page.locator('#patron-lista').getByRole('button', { name: 'Filtrar' }).click();
    const dialog = page.getByRole('dialog', { name: 'Filtros' });
    await dialog.getByRole('button', { name: 'Kit' }).click();
    await expect(dialog.getByRole('button', { name: 'Limpiar Filtros (1)' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/D-products-filter.png` });
    await dialog.getByRole('button', { name: 'Limpiar Filtros (1)' }).click();
    await expect(dialog.getByRole('button', { name: 'Limpiar Filtros (0)' })).toBeVisible();
  });

  test('captura completa del catálogo', async ({ page }) => {
    await go(page, '/design');
    await page.getByTestId('main').evaluate((m) => (m.style.overflow = 'visible'));
    await page.screenshot({ path: `${SHOTS}/design-system-full.png`, fullPage: true });
  });
});
