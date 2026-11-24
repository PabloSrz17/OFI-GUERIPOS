import { test, expect, type Page } from '@playwright/test';

const SHOTS = 'docs/stage-4/screenshots';

type Dev = { __posDev: { seedClients: () => Promise<number>; query: (s: string) => Promise<Record<string, unknown>[]> } };

async function open(page: Page, hash: string, opts: { seed?: boolean } = {}) {
  await page.goto(`/#${hash}`);
  await page.waitForFunction(() => (window as unknown as { __posDev?: unknown }).__posDev);
  if (opts.seed) await page.evaluate(() => (window as unknown as Dev).__posDev.seedClients());
  await page.evaluate(() => document.fonts.ready);
}

const sql = (page: Page, query: string) => page.evaluate((q) => (window as unknown as Dev).__posDev.query(q), query);

test.describe('Clientes', () => {
  test('alta con dirección y comentarios, y detalle', async ({ page }) => {
    await open(page, '/clients');
    await expect(page.getByRole('heading', { name: 'Aún no tienes clientes' })).toBeVisible();
    await page.getByRole('button', { name: 'Agregar Cliente' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Nuevo Cliente' });
    const create = dialog.getByRole('button', { name: 'Crear Cliente' });
    await expect(create).toBeDisabled();
    await expect(dialog.getByLabel('Nombre')).toBeFocused();
    await dialog.getByLabel('Nombre').fill('Adela');
    await dialog.getByLabel('Apellido').fill('Paredes');
    await dialog.getByPlaceholder('Ingresar teléfono').fill('555 010-2030');
    await dialog.getByLabel('Email').fill('adela@ejemplo.mx');
    await dialog.getByLabel('Asignar una lista de precios al cliente').check();
    await dialog.getByRole('combobox', { name: 'Lista de precios del cliente' }).click();
    await page.getByRole('option', { name: 'Público' }).click();
    await page.screenshot({ path: `${SHOTS}/J-client-new-form.png` });

    await dialog.getByRole('button', { name: 'Añadir Dirección' }).click();
    const addr = page.getByRole('dialog', { name: 'Ingresar Dirección' });
    await addr.getByLabel('Calle').fill('Calle 10');
    await addr.getByLabel('Número Exterior').fill('214');
    await addr.getByLabel('Código postal').fill('24000');
    await addr.getByLabel('Colonia').fill('Centro');
    await addr.getByLabel('Ciudad').fill('Campeche');
    await addr.getByRole('combobox', { name: 'Estado' }).click();
    await page.getByRole('option', { name: 'Campeche' }).click();
    await page.screenshot({ path: `${SHOTS}/J-client-new-address.png` });
    await addr.getByRole('button', { name: 'Guardar' }).click();
    await expect(addr).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Calle 10 #214, Centro, CP 24000, Campeche, Campeche')).toBeVisible();
    await dialog.getByLabel('Comentarios').fill('Entregar por la tarde');
    await dialog.getByLabel('Comentarios').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/J-client-new-form-bottom.png` });
    await create.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Cliente creado' })).toBeVisible();

    // Llega al detalle del cliente nuevo.
    await expect(page.getByRole('heading', { name: 'Adela Paredes' })).toBeVisible();
    await expect(page.getByText('Sin limitar')).toBeVisible();
    await expect(page.getByText('Entregar por la tarde')).toBeVisible();
    await expect(page.locator('section', { hasText: 'Lista de Precios' }).getByText('Público')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/J-client-detail-nodebt.png` });
    await page.getByRole('button', { name: 'Ver Más' }).click();
    await expect(page.getByText('+525550102030')).toBeVisible();
    await expect(page.getByText('Calle 10 #214, Centro, CP 24000, Campeche, Campeche')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/J-client-basic-more.png` });

    const [row] = await sql(page, "SELECT phone, phone_country, address_state, (SELECT count(*) FROM outbox WHERE entity = 'client') o FROM clients");
    expect(row).toEqual({ phone: '5550102030', phone_country: '+52', address_state: 'Campeche', o: 1 });
  });

  test('validaciones del formulario', async ({ page }) => {
    await open(page, '/clients');
    await page.getByRole('button', { name: 'Agregar Cliente' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Nuevo Cliente' });
    await dialog.getByLabel('Nombre').fill('X');
    await dialog.getByLabel('Email').fill('correo-malo');
    await dialog.getByRole('button', { name: 'Crear Cliente' }).click();
    await expect(dialog.getByText('El email no es válido')).toBeVisible();
    await dialog.getByLabel('Email').fill('');
    await dialog.getByPlaceholder('Ingresar teléfono').fill('12ab');
    await dialog.getByRole('button', { name: 'Crear Cliente' }).click();
    await expect(dialog.getByText(/El teléfono debe tener solo números/)).toBeVisible();
    expect(await sql(page, 'SELECT id FROM clients')).toEqual([]);
  });

  test('editar datos, límite de crédito, lista de precios, comentarios y eliminar', async ({ page }) => {
    await open(page, '/clients', { seed: true });
    await page.getByRole('link', { name: 'Bruno Díaz' }).click();
    await expect(page.getByRole('heading', { name: 'Bruno Díaz' })).toBeVisible();

    await page.getByRole('button', { name: 'Editar Datos Básicos' }).click();
    const edit = page.getByRole('dialog', { name: 'Editar Cliente' });
    await expect(edit.getByLabel('Nombre')).toHaveValue('Bruno');
    await expect(edit.getByPlaceholder('Ingresar teléfono')).toHaveValue('5550203040');
    await page.screenshot({ path: `${SHOTS}/J-client-edit-basic.png` });
    await edit.getByLabel('Apellido').fill('Díaz Ortega');
    await edit.getByRole('button', { name: 'Guardar Cambios' }).click();
    await expect(page.getByRole('heading', { name: 'Bruno Díaz Ortega' })).toBeVisible();

    await page.getByRole('button', { name: 'Editar Límite de Crédito' }).click();
    const limit = page.getByRole('dialog', { name: 'Editar Límite de Crédito' });
    await expect(limit.getByRole('radio', { name: /Límite predeterminado/ })).toBeChecked();
    await page.screenshot({ path: `${SHOTS}/J-client-credit-limit.png` });
    await limit.getByRole('radio', { name: 'Personalizar límite para este cliente' }).check();
    await limit.getByLabel('Monto del límite').fill('1500');
    await limit.getByRole('button', { name: 'Guardar' }).click();
    await expect(limit).toBeHidden();
    await expect(page.locator('section', { hasText: 'Límite de Crédito' }).getByText('$1,500.00')).toBeVisible();

    await page.getByRole('button', { name: 'Editar Lista de Precios' }).click();
    const lists = page.getByRole('dialog', { name: 'Editar Lista de Precios' });
    await lists.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Público' }).click();
    await lists.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('section', { hasText: 'Lista de Precios' }).getByText('Público')).toBeVisible();

    await page.getByRole('button', { name: 'Agregar' }).click();
    const comments = page.getByRole('dialog', { name: 'Comentarios' });
    await comments.getByRole('textbox').fill('Paga los viernes');
    await comments.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Paga los viernes')).toBeVisible();

    const [c] = await sql(page, "SELECT last_name, credit_limit_cents, comments, price_list_id IS NOT NULL l FROM clients WHERE first_name = 'Bruno'");
    expect(c).toEqual({ last_name: 'Díaz Ortega', credit_limit_cents: 150000, comments: 'Paga los viernes', l: 1 });

    await page.getByRole('button', { name: 'Más Acciones' }).click();
    await expect(page.getByRole('menuitem', { name: 'Nueva Venta' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/J-client-more-actions.png` });
    await page.getByRole('menuitem', { name: 'Eliminar Cliente' }).click();
    await page.getByRole('dialog', { name: 'Eliminar cliente' }).getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Bruno/ })).toHaveCount(0);
    const [d] = await sql(page, "SELECT deleted_at IS NOT NULL d FROM clients WHERE first_name = 'Bruno'");
    expect(d).toEqual({ d: 1 });
  });

  test('lista: buscar, ordenar, filtrar por lista y exportar', async ({ page }) => {
    await open(page, '/clients', { seed: true });
    const names = () => page.locator('tbody tr td:nth-child(2)').allInnerTexts();
    await expect(page.getByRole('row')).toHaveCount(11);
    expect((await names())[0]).toBe('Andrea Campos');
    await expect(page.getByRole('row', { name: /Andrea Campos/ }).getByRole('cell', { name: '+525550102030' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/J-clients-list.png` });

    await page.getByLabel('Buscar clientes').fill('galvez');
    await expect(page.getByRole('row')).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'Ernesto Gálvez' })).toBeVisible();
    await page.getByLabel('Buscar clientes').fill('ejemplo.mx');
    await expect(page.getByRole('row')).toHaveCount(5);
    await page.getByLabel('Buscar clientes').fill('zzz');
    await expect(page.getByText('No se encontraron clientes para esta búsqueda')).toBeVisible();
    await page.getByLabel('Buscar clientes').fill('');
    await expect(page).not.toHaveURL(/q=/);

    await page.getByRole('combobox', { name: 'Ordenar' }).click();
    await page.screenshot({ path: `${SHOTS}/J-clients-sort.png` });
    await page.getByRole('option', { name: 'Nombre (Z - A)' }).click();
    await expect(page.locator('tbody tr').first()).toContainText('Julia Kuri');

    // Asigna una lista a un cliente y filtra por ella.
    await page.getByRole('link', { name: 'Iván Juárez' }).click();
    await page.getByRole('button', { name: 'Editar Lista de Precios' }).click();
    await page.getByRole('dialog').getByRole('combobox').click();
    await page.getByRole('option', { name: 'Público' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
    await page.getByRole('button', { name: 'Regresar' }).click();
    await page.getByRole('button', { name: 'Filtrar' }).click();
    const filters = page.getByRole('dialog', { name: 'Filtros' });
    await filters.getByRole('combobox', { name: 'Lista de Precio' }).click();
    await page.getByRole('option', { name: 'Público' }).click();
    await page.screenshot({ path: `${SHOTS}/J-clients-filter.png` });
    await filters.getByRole('button', { name: 'Ver Resultados' }).click();
    await expect(page.getByRole('row')).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'Iván Juárez' })).toBeVisible();

    // Exportar: se intercepta la descarga dentro de la página.
    await page.evaluate(() => {
      const w = window as unknown as { __csv?: string };
      HTMLAnchorElement.prototype.click = function () {
        fetch(this.href).then((r) => r.text()).then((t) => (w.__csv = t));
      };
    });
    await page.getByRole('button', { name: 'Exportar' }).click();
    await page.waitForFunction(() => (window as unknown as { __csv?: string }).__csv);
    const csv = await page.evaluate(() => (window as unknown as { __csv: string }).__csv);
    expect(csv).toContain('Nombre,Apellido,Teléfono,Email,Lista de Precios,Dirección,Comentarios');
    expect(csv).toContain('Iván,Juárez,+525550708090,ivan.juarez@ejemplo.mx,Público');
    expect(csv.split('\r\n')).toHaveLength(11);
  });
});
