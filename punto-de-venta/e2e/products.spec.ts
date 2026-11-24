import { test, expect, type Page } from '@playwright/test';

const SHOTS = 'docs/stage-3/screenshots';

// Cada prueba corre en un contexto nuevo de Playwright: IndexedDB vacía = base de datos nueva.
async function open(page: Page, hash: string, opts: { seed?: boolean } = {}) {
  await page.goto(`/#${hash}`);
  await page.waitForFunction(() => 'window' in globalThis && (window as unknown as { __posDev?: unknown }).__posDev);
  if (opts.seed) {
    await page.evaluate(() => (window as unknown as { __posDev: { seedDemo: () => Promise<number> } }).__posDev.seedDemo());
  }
  await page.evaluate(() => document.fonts.ready);
}

const sql = (page: Page, query: string) => page.evaluate((q) => (window as unknown as { __posDev: { query: (s: string) => Promise<Record<string, unknown>[]> } }).__posDev.query(q), query);

test.describe('Productos', () => {
  test('alta rápida con categoría nueva y stock inicial (atómica, con movimiento y outbox)', async ({ page }) => {
    await open(page, '/products');
    await expect(page.getByRole('heading', { name: 'Aún no tienes productos' })).toBeVisible();
    await page.getByRole('button', { name: 'Agregar Producto' }).first().click();
    await page.getByRole('menuitem', { name: /Nuevo Producto/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Crear Producto Rápido' });
    const create = dialog.getByRole('button', { name: 'Crear Producto' });
    await expect(create).toBeDisabled();
    await expect(dialog.getByPlaceholder('Ej: Jabón de mano')).toBeFocused();
    await dialog.getByPlaceholder('Ej: Jabón de mano').fill('Jabón de mano');
    await dialog.getByLabel('Existencias').fill('5');
    await dialog.getByLabel('Código de barras').fill('7501234567890');
    await dialog.getByRole('combobox').click();
    await dialog.getByRole('combobox').fill('Limpieza');
    await expect(page.getByRole('option', { name: 'Crear categoría "Limpieza"' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/E-category-combobox.png` });
    await page.getByRole('option', { name: 'Crear categoría "Limpieza"' }).click();
    await expect(dialog.getByText('Nueva')).toBeVisible();
    await dialog.getByLabel('Precio de venta').fill('25');
    await dialog.getByLabel('Costo', { exact: true }).fill('14.5');
    await page.screenshot({ path: `${SHOTS}/D-product-new-form.png` });
    await create.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Producto creado' })).toBeVisible();

    const row = page.getByRole('row', { name: /Jabón de mano/ });
    await expect(row.getByText('5 unidades')).toHaveCSS('background-color', 'rgb(220, 252, 231)');
    await expect(row.getByRole('cell', { name: 'Limpieza' })).toBeVisible();
    await expect(row.getByRole('cell', { name: '$25.00' })).toBeVisible();

    const [counts] = await sql(
      page,
      `SELECT (SELECT count(*) FROM products) p, (SELECT count(*) FROM categories) c, (SELECT count(*) FROM inventory_movements WHERE description = 'Stock inicial' AND quantity = 5) m,
              (SELECT count(*) FROM outbox WHERE entity IN ('product','category','inventory_movement')) o`,
    );
    expect(counts).toEqual({ p: 1, c: 1, m: 1, o: 3 });

    // Detalle con el kardex.
    await row.getByRole('link', { name: 'Jabón de mano' }).click();
    await expect(page.getByRole('heading', { name: 'Detalle del Producto' })).toBeVisible();
    const mov = page.getByRole('row', { name: /Stock inicial/ });
    await expect(mov.getByText('Entrada')).toBeVisible();
    await expect(mov.getByRole('cell', { name: '+5' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Público/ }).getByRole('cell', { name: '42%' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/D-product-detail.png` });

    // Los datos sobreviven a recargar la app (persistencia en la base local).
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Jabón de mano' })).toBeVisible();
  });

  test('"Ir al Editor Completo" conserva lo escrito; editor completo con marca, mínimo y márgenes', async ({ page }) => {
    await open(page, '/');
    await page.getByRole('link', { name: 'Crear Producto' }).click();
    const dialog = page.getByRole('dialog', { name: 'Crear Producto Rápido' });
    await dialog.getByPlaceholder('Ej: Jabón de mano').fill('Cemento gris 25 kg');
    await dialog.getByLabel('Existencias').fill('10');
    await dialog.getByRole('button', { name: 'Ir al Editor Completo' }).click();

    await expect(page.getByRole('heading', { name: 'Agregar Producto' })).toBeVisible();
    await expect(page.getByLabel('Nombre del producto*')).toHaveValue('Cemento gris 25 kg');
    await expect(page.getByLabel('Cantidad', { exact: true })).toHaveValue('10');
    await page.getByLabel('SKU').fill('CEM-25');
    await page.locator('#pe-brand').fill('Cemex');
    await page.getByRole('option', { name: 'Crear marca "Cemex"' }).click();
    await page.getByLabel('Cantidad mínima').fill('5');
    await page.getByLabel('Costo', { exact: true }).fill('180');
    await page.getByLabel('Precio Público').fill('220');
    await expect(page.getByRole('row', { name: /Público/ }).getByRole('cell', { name: '18.2%' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Público/ }).getByRole('cell', { name: '$40.00' })).toBeVisible();

    await page.getByRole('button', { name: 'Agregar Lista de Precios' }).click();
    await page.getByRole('dialog', { name: 'Agregar Lista de Precios' }).getByLabel('Nombre de la lista').fill('Mayoreo');
    await page.getByRole('button', { name: 'Crear Lista' }).click();
    await page.getByLabel('Precio Mayoreo').fill('205');

    // Captura de página completa: se agranda el viewport al alto del contenido (el main tiene scroll propio).
    const full = await page.getByTestId('main').evaluate((m) => m.scrollHeight + 64);
    await page.setViewportSize({ width: 1416, height: full });
    await page.screenshot({ path: `${SHOTS}/D-product-full-editor.png` });
    await page.setViewportSize({ width: 1416, height: 808 });

    // Cancelar con cambios pide confirmación.
    await page.getByRole('button', { name: 'Cancelar' }).click();
    const unsaved = page.getByRole('dialog', { name: 'Tienes cambios sin guardar' });
    await expect(unsaved).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/D-product-unsaved-dialog.png` });
    await unsaved.getByRole('button', { name: 'Continuar Editando' }).click();
    await expect(unsaved).toBeHidden();

    await page.getByRole('button', { name: 'Crear Producto' }).click();
    await expect(page.getByRole('heading', { name: 'Detalle del Producto' })).toBeVisible();
    await expect(page.getByText('SKU: CEM-25')).toBeVisible();
    await expect(page.getByRole('row', { name: /Mayoreo/ }).getByRole('cell', { name: '$205.00' })).toBeVisible();
    await expect(page.getByRole('row', { name: /^Sucursal Principal/ })).toContainText('10');
  });

  test('editar no cambia existencias; SKU repetido muestra error en el campo', async ({ page }) => {
    await open(page, '/products', { seed: true });
    await page.getByRole('link', { name: 'Brocha 2"' }).click();
    await page.getByRole('link', { name: 'Editar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar Producto' })).toBeVisible();
    await expect(page.getByLabel('Cantidad', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Cantidad', { exact: true })).toHaveValue('18');
    await page.getByLabel('SKU').fill('ROD-9');
    await page.getByRole('button', { name: 'Guardar Cambios' }).click();
    await expect(page.getByText('Ya existe un producto con este SKU')).toBeVisible();
    await page.getByLabel('SKU').fill('BRO-2B');
    await page.getByLabel('Precio Público').fill('31');
    await page.getByRole('button', { name: 'Guardar Cambios' }).click();
    await expect(page.getByText('SKU: BRO-2B')).toBeVisible();
    await expect(page.getByRole('row', { name: /^Sucursal Principal/ })).toContainText('18');
    const [r] = await sql(page, "SELECT count(*) n FROM inventory_movements m JOIN products p ON p.id = m.product_id WHERE p.sku = 'BRO-2B'");
    expect(r.n).toBe(1);
  });

  test('lista: buscar sin acentos, sin resultados, filtros, orden y paginación', async ({ page }) => {
    await open(page, '/products', { seed: true });
    await expect(page.getByRole('button', { name: '2', exact: true })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/D-products-list.png` });

    const search = page.getByLabel('Buscar productos');
    await search.fill('silicon');
    await expect(page.getByRole('link', { name: 'Silicón transparente' })).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(2);
    await expect(page).toHaveURL(/q=silicon/);
    await search.fill('zzz');
    await expect(page.getByText('No se encontraron productos para esta búsqueda')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/D-products-search-empty.png` });
    await search.fill('');
    await expect(page).not.toHaveURL(/q=/);

    await page.getByRole('button', { name: 'Filtrar' }).click();
    const filters = page.getByRole('dialog', { name: 'Filtros' });
    await filters.getByRole('button', { name: 'Sin stock' }).click();
    await expect(filters.getByRole('button', { name: 'Limpiar Filtros (1)' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/D-products-filter.png` });
    await filters.getByRole('button', { name: 'Ver Resultados' }).click();
    // 0, 0, 0, −2, −4 → cinco productos sin stock.
    await expect(page.getByRole('row')).toHaveCount(6);
    await expect(page.getByRole('button', { name: /Filtrar/ })).toContainText('1');

    await page.getByRole('button', { name: /Filtrar/ }).click();
    await filters.getByRole('button', { name: 'Limpiar Filtros (1)' }).click();
    await filters.getByRole('button', { name: 'Ver Resultados' }).click();

    await page.getByRole('combobox', { name: 'Ordenar' }).click();
    await page.screenshot({ path: `${SHOTS}/D-products-sort.png` });
    await page.getByRole('option', { name: 'Menos Stock' }).click();
    await expect(page.getByRole('row').nth(1)).toContainText('Masilla fibratada 20 kg');
    await expect(page.getByRole('row').nth(1).getByText('-4 unidades')).toHaveCSS('background-color', 'rgb(254, 226, 226)');

    await page.getByRole('button', { name: '2', exact: true }).click();
    await expect(page.getByRole('row')).toHaveCount(3); // 27 productos: 25 + 2
  });

  test('descarga CSV', async ({ page }) => {
    await open(page, '/products', { seed: true });
    // Edge controlado por Playwright se cierra al descargar, así que se intercepta el enlace de descarga.
    await page.evaluate(() => {
      const w = window as unknown as { __dl: Promise<{ name: string; text: string }> };
      w.__dl = new Promise((resolve) => {
        HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
          fetch(this.href).then((r) => r.text()).then((text) => resolve({ name: this.download, text }));
        };
      });
    });
    await page.getByRole('button', { name: 'Descargar Productos' }).click();
    const dl = await page.evaluate(() => (window as unknown as { __dl: Promise<{ name: string; text: string }> }).__dl);
    expect(dl.name).toBe('productos.csv');
    expect(dl.text).toContain('Nombre,SKU,Código de barras');
    expect(dl.text).toContain('"Abrazadera de uña 2""",ABR-U2');
  });

  test('eliminar con confirmación (borrado lógico)', async ({ page }) => {
    await open(page, '/products', { seed: true });

    await page.getByLabel('Seleccionar Rodillo 9"').click();
    await page.getByLabel('Seleccionar Thinner 1 L').click();
    await expect(page.getByText('2 productos seleccionados')).toBeVisible();
    await page.getByRole('button', { name: 'Eliminar' }).click();
    await page.getByRole('dialog', { name: 'Eliminar 2 productos' }).getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.getByRole('link', { name: 'Rodillo 9"' })).toHaveCount(0);
    const [r] = await sql(page, "SELECT count(*) n FROM products WHERE deleted_at IS NOT NULL");
    expect(r.n).toBe(2);
  });
});

test.describe('Categorías (Preferencias → Productos → Categorías)', () => {
  test('crear, editar y eliminar', async ({ page }) => {
    await open(page, '/products', { seed: true });
    await page.getByRole('link', { name: 'Preferencias' }).click();
    await expect(page).toHaveURL(/#\/settings\/products$/);
    await page.screenshot({ path: `${SHOTS}/E-settings-products.png` });
    await page.getByRole('link', { name: 'Categorías' }).click();
    await expect(page.getByRole('heading', { name: 'Categorías de Productos' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Plomería/ })).toContainText('4');
    await page.screenshot({ path: `${SHOTS}/E-categories-list.png` });

    await page.getByRole('button', { name: 'Agregar Categoría' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Crear Categoría' });
    await expect(dialog.getByRole('button', { name: 'Crear Categoría' })).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}/E-category-add-modal.png` });
    await dialog.getByPlaceholder('Indicar nombre').fill('plomería');
    await dialog.getByRole('button', { name: 'Crear Categoría' }).click();
    await expect(dialog.getByText('Ya existe una categoría con este nombre')).toBeVisible();
    await dialog.getByPlaceholder('Indicar nombre').fill('Jardinería');
    await dialog.getByRole('button', { name: 'Crear Categoría' }).click();
    await expect(page.getByRole('row', { name: /Jardinería/ })).toContainText('0');

    await page.getByRole('button', { name: 'Editar Pintura' }).click();
    const edit = page.getByRole('dialog', { name: 'Editar Categoría' });
    await expect(edit.getByRole('button', { name: 'Guardar Cambios' })).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}/E-category-edit-modal.png` });
    await edit.getByPlaceholder('Indicar nombre').fill('Pinturas');
    await edit.getByRole('button', { name: 'Guardar Cambios' }).click();
    await expect(page.getByRole('row', { name: /Pinturas/ })).toBeVisible();

    await page.getByRole('button', { name: 'Eliminar Pinturas' }).click();
    const confirm = page.getByRole('dialog', { name: 'Eliminar categoría' });
    await expect(confirm).toContainText('quedarán "Sin Categoría"');
    await confirm.getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.getByRole('row', { name: /Pinturas/ })).toHaveCount(0);

    await page.goto('/#/products');
    await expect(page.getByRole('row', { name: /Brocha 2"/ }).getByRole('cell').nth(3)).toHaveText('');
  });
});
