import { test, expect, type Browser, type Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Prueba integral con el Servidor POS real (build/ServidorPOS/servidor.cjs, que sirve la app de producción) y dos
 * "PCs" (dos navegadores independientes). Requiere `npm run build && node tools/build-server.mjs --no-exe`.
 */
const SHOTS = 'docs/stage-9/screenshots';
const PORT = 8431;
const URL = `http://localhost:${PORT}`;
const SERVER = resolve('build/ServidorPOS/servidor.cjs');

let home: string;
let server: ChildProcess | null = null;
let seedFile: string;

async function startServer() {
  server = spawn(process.execPath, [SERVER], { env: { ...process.env, POS_PORT: String(PORT), POS_HOME: home, POS_PRINT_DRYRUN: join(home, 'tickets') }, stdio: 'pipe' });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${URL}/api/info`)).ok) return;
    } catch {
      /* todavía no */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('El servidor no arrancó');
}
async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>((r) => {
    s.once('exit', () => r());
    s.kill();
  });
}

test.skip(!existsSync(SERVER), 'Falta build/ServidorPOS/servidor.cjs (node tools/build-server.mjs --no-exe)');

test.beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'pos-server-'));
  // Base inicial con el catálogo de prueba: es la que "se restauró" desde una PC.
  seedFile = join(home, 'respaldo-inicial.sqlite');
  execFileSync(process.execPath, [resolve('tools/make-demo-db.mjs'), seedFile]);
  mkdirSync(join(home, 'datos'), { recursive: true });
  copyFileSync(seedFile, join(home, 'datos', 'pos.sqlite'));
  await startServer();
});
test.afterAll(stopServer);

/** Contraseña de prueba (la del negocio nunca va en el repositorio). */
const USER = 'admin';
let password = 'prueba123';

async function login(page: Page, pw = password) {
  const form = page.getByRole('form', { name: 'Iniciar sesión' });
  await expect(form).toBeVisible();
  await form.getByLabel('Usuario').fill(USER);
  await form.getByLabel('Contraseña', { exact: true }).fill(pw);
  await form.getByRole('button', { name: 'Entrar' }).click();
}

async function openPc(browser: Browser, opts: { login?: boolean } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1416, height: 808 }, locale: 'es-MX' });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.assign(window, { __posNoPrint: true });
    const w = window as unknown as { __downloads: string[] };
    w.__downloads = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.download) return void w.__downloads.push(this.download);
      return orig.call(this);
    };
  });
  await page.goto(`${URL}/#/pos`);
  if (opts.login === false) return page;
  await login(page);
  await expect(page.getByTestId('connection')).toHaveText('Conectado al servidor');
  return page;
}

const checkout = (page: Page) => page.getByRole('dialog', { name: /Cobrar|registrada/ });
async function sell(page: Page, q: string, option: RegExp) {
  await page.goto(`${URL}/#/pos`);
  await page.getByRole('textbox', { name: 'Buscar productos' }).fill(q);
  await page.getByRole('option', { name: option }).first().click();
  await page.getByRole('button', { name: /^Cobrar \$/ }).click();
  await checkout(page).getByRole('button', { name: /^Cobrar \$/ }).click();
  const done = checkout(page).getByText(/^Venta N\d+ registrada$/);
  await expect(done).toBeVisible();
  const folio = (await done.textContent())!.match(/N\d+/)![0];
  await checkout(page).getByRole('button', { name: 'Nueva Venta' }).click();
  return folio;
}

test.describe('Varias PCs con el Servidor POS', () => {
  test.describe.configure({ timeout: 120_000, mode: 'serial' });

  test('acceso: crear el usuario en la PC servidor, iniciar sesión y API protegida', async ({ browser }) => {
    // Sin sesión, la API no entrega datos.
    expect((await fetch(`${URL}/api/snapshot`)).status).toBe(401);
    expect((await fetch(`${URL}/api/commit`, { method: 'POST', body: '{}' })).status).toBe(401);
    const info = await (await fetch(`${URL}/api/info`)).json();
    expect(info).toEqual({ pos: true, schema: expect.any(Number), auth: { configured: false, user: null, canSetup: true } });

    // Primera vez, desde la PC servidor (localhost): se crea el usuario.
    const a = await openPc(browser, { login: false });
    const setup = a.getByRole('form', { name: 'Crear usuario' });
    await setup.getByLabel('Usuario').fill(USER);
    await setup.getByLabel('Contraseña', { exact: true }).fill(password);
    await setup.getByLabel('Confirmar contraseña').fill('otra-cosa');
    await setup.getByRole('button', { name: 'Crear y entrar' }).click();
    await expect(setup.getByRole('alert')).toHaveText('Las contraseñas no coinciden');
    await setup.getByLabel('Confirmar contraseña').fill(password);
    await a.screenshot({ path: `${SHOTS}/P-setup.png` });
    await setup.getByRole('button', { name: 'Crear y entrar' }).click();
    await expect(a.getByTestId('connection')).toHaveText('Conectado al servidor');
    await expect(a.getByTestId('header')).toContainText(USER);
    expect((await fetch(`${URL}/api/setup`, { method: 'POST', body: JSON.stringify({ user: 'otro', password: 'x123456' }) })).status).toBe(409);

    // Otra PC: pide la contraseña.
    const b = await openPc(browser, { login: false });
    await login(b, 'equivocada');
    await expect(b.getByRole('form', { name: 'Iniciar sesión' }).getByRole('alert')).toHaveText('Usuario o contraseña incorrectos');
    await b.screenshot({ path: `${SHOTS}/P-login.png` });
    await b.getByRole('form', { name: 'Iniciar sesión' }).getByLabel('Contraseña', { exact: true }).fill(password);
    await b.getByRole('button', { name: 'Entrar' }).click();
    await expect(b.getByTestId('connection')).toHaveText('Conectado al servidor', { timeout: 15_000 });
    await a.context().close();
    await b.context().close();
  });

  test('ventas compartidas, al mismo tiempo, sin conexión, reconexión y respaldo', async ({ browser }) => {
    const a = await openPc(browser);
    const b = await openPc(browser);
    await a.screenshot({ path: `${SHOTS}/P-connected.png` });

    // Lo que vende A aparece en B sin recargar.
    expect(await sell(a, 'cemento', /Cemento gris 25 kg/)).toBe('N1');
    await b.goto(`${URL}/#/sales`);
    await expect(b.getByRole('link', { name: 'N1', exact: true })).toBeVisible();

    // A y B cobran al mismo tiempo: folios distintos y el stock baja dos veces.
    const [fa, fb] = await Promise.all([sell(a, 'varilla', /Varilla 3\/8"/), sell(b, 'varilla', /Varilla 3\/8"/)]);
    expect(new Set([fa, fb])).toEqual(new Set(['N2', 'N3']));
    const info = await a.evaluate(() => fetch('/api/info').then((r) => r.json()));
    expect(info.version).toBeGreaterThanOrEqual(3);
    await b.goto(`${URL}/#/sales`);
    await expect(b.getByRole('link', { name: 'N3', exact: true })).toBeVisible();
    await b.screenshot({ path: `${SHOTS}/P-shared-sales.png` });

    // Se apaga el servidor: A puede consultar pero no vender.
    await stopServer();
    await expect(a.getByTestId('connection')).toHaveText('Sin conexión con el servidor', { timeout: 40_000 });
    await expect(a.getByRole('alert').filter({ hasText: 'Sin conexión con el Servidor POS' })).toBeVisible();
    await a.goto(`${URL}/#/sales`);
    await expect(a.getByRole('link', { name: 'N3', exact: true })).toBeVisible();
    await a.goto(`${URL}/#/pos`);
    await a.getByRole('textbox', { name: 'Buscar productos' }).fill('brocha');
    await a.getByRole('option', { name: /Brocha 2"/ }).first().click();
    await a.getByRole('button', { name: /^Cobrar \$/ }).click();
    await checkout(a).getByRole('button', { name: /^Cobrar \$/ }).click();
    await expect(a.getByText(/Sin conexión con el servidor: no se guardó/)).toBeVisible();
    await a.screenshot({ path: `${SHOTS}/P-offline.png` });
    await a.keyboard.press('Escape');

    // Vuelve el servidor (mismo archivo): las PCs se reconectan solas y no se perdió nada.
    await startServer();
    await expect(a.getByTestId('connection')).toHaveText('Conectado al servidor', { timeout: 20_000 });
    expect(await sell(a, 'brocha', /Brocha 2"/)).toBe('N4');
    await b.goto(`${URL}/#/sales`);
    await expect(b.getByRole('link', { name: 'N4', exact: true })).toBeVisible({ timeout: 15_000 });

    // Respaldo: descargar y restaurar el inicial (las dos PCs recargan, sin ventas).
    await a.goto(`${URL}/#/settings/backup`);
    await expect(a.getByRole('heading', { name: 'Los datos están en el Servidor POS' })).toBeVisible();
    await expect(a.getByRole('cell', { name: /^automatico-/ })).toHaveCount(1); // uno al día, aunque el servidor se reinicie
    // Hay ventas y nunca se descargó un respaldo: aparece el aviso diario.
    await expect(a.getByTestId('backup-reminder')).toContainText('Todavía no has descargado ningún respaldo');
    await a.screenshot({ path: `${SHOTS}/P-backup-reminder.png` });
    await a.getByTestId('main').getByRole('button', { name: 'Descargar Respaldo' }).click();
    await expect(a.getByTestId('last-download')).toHaveText(/^Hoy/);
    await a.goto(`${URL}/#/sales`);
    await expect(a.getByRole('link', { name: 'N4', exact: true })).toBeVisible();
    await expect(a.getByTestId('backup-reminder')).toHaveCount(0);
    await a.goto(`${URL}/#/settings/backup`);
    expect(await a.evaluate(() => (window as unknown as { __downloads: string[] }).__downloads)).toEqual([expect.stringMatching(/^respaldo-pos-.*\.sqlite$/)]);
    await a.screenshot({ path: `${SHOTS}/P-backup-server.png` });
    await a.getByLabel('Archivo de respaldo').setInputFiles(seedFile);
    const confirm = a.getByRole('dialog', { name: 'Restaurar respaldo' });
    await expect(confirm).toContainText('0 ventas, 27 productos y 10 clientes');
    await expect(confirm).toContainText('en todas las PCs');
    await a.screenshot({ path: `${SHOTS}/P-restore-confirm.png` });
    await confirm.getByRole('button', { name: 'Restaurar' }).click();
    await expect(a.getByText(/Respaldo restaurado/)).toBeVisible();
    await expect(a.getByRole('cell', { name: /^antes-de-restaurar-/ })).toBeVisible();
    await b.goto(`${URL}/#/sales`);
    await expect(b.getByRole('link', { name: 'N1', exact: true })).toHaveCount(0, { timeout: 15_000 });
    // Y se sigue vendiendo; el folio vuelve a N1 porque el respaldo no tenía ventas.
    expect(await sell(b, 'cemento', /Cemento gris 25 kg/)).toBe('N1');
  });

  test('los tickets de cualquier PC salen en la impresora de la PC servidor', async ({ browser }) => {
    const tickets = () => (existsSync(join(home, 'tickets')) ? readdirSync(join(home, 'tickets')).sort().map((f) => readFileSync(join(home, 'tickets', f)).toString('latin1')) : []);
    const b = await openPc(browser);
    await b.goto(`${URL}/#/settings/tickets`);
    await b.getByLabel('Imprimir los tickets en la impresora de la PC servidor').click();
    await b.getByRole('combobox', { name: 'Impresora', exact: true }).click();
    await b.getByRole('option', { name: 'Impresora de prueba (predeterminada)' }).click();
    await expect(b.getByLabel('Vista previa del ticket de prueba')).toContainText('Prueba de impresión');
    await b.getByRole('button', { name: 'Imprimir prueba' }).click();
    await expect(b.getByText('Prueba enviada a la impresora')).toBeVisible();
    await expect.poll(() => tickets().length, { timeout: 15_000 }).toBe(1);
    expect(tickets()[0]).toContain('Prueba de impresi\xa2n');
    await b.screenshot({ path: `${SHOTS}/P-printer-settings.png`, fullPage: true });

    // Una venta en otra PC: "Imprimir Ticket" la manda a la impresora del servidor (con corte de papel).
    await b.goto(`${URL}/#/pos`);
    await b.getByRole('textbox', { name: 'Buscar productos' }).fill('cemento');
    await b.getByRole('option', { name: /Cemento gris 25 kg/ }).first().click();
    await b.getByRole('button', { name: /^Cobrar \$/ }).click();
    await checkout(b).getByRole('button', { name: /^Cobrar \$/ }).click();
    const done = checkout(b).getByText(/^Venta N\d+ registrada$/);
    await expect(done).toBeVisible();
    const folio = (await done.textContent())!.match(/N\d+/)![0];
    await checkout(b).getByRole('button', { name: 'Imprimir Ticket' }).click();
    await expect.poll(() => tickets().length, { timeout: 15_000 }).toBe(2);
    const t = tickets()[1];
    expect(t).toContain(folio);
    expect(t).toContain('Cemento gris 25 kg');
    expect(t.endsWith('\x1dVB\x00')).toBe(true);
    await b.context().close();
  });

  test('cambiar la contraseña saca a las demás PCs; cerrar sesión', async ({ browser }) => {
    const a = await openPc(browser);
    const b = await openPc(browser);
    await a.getByTestId('header').getByRole('button', { name: new RegExp(USER) }).click();
    await a.getByRole('menuitem', { name: 'Cambiar contraseña' }).click();
    await expect(a.getByRole('heading', { name: `Sesión iniciada como ${USER}` })).toBeVisible();
    const form = a.getByRole('form', { name: 'Cambiar contraseña' });
    await form.getByLabel('Contraseña actual').fill('mal');
    await form.getByLabel('Contraseña nueva', { exact: true }).fill('nueva456');
    await form.getByLabel('Confirmar contraseña nueva').fill('nueva456');
    await form.getByRole('button', { name: 'Cambiar contraseña' }).click();
    await expect(form.getByRole('alert')).toHaveText('La contraseña actual no es correcta');
    await form.getByLabel('Contraseña actual').fill(password);
    await form.getByRole('button', { name: 'Cambiar contraseña' }).click();
    await expect(a.getByText('Contraseña cambiada. Las demás PCs tendrán que volver a iniciar sesión.')).toBeVisible();
    await a.screenshot({ path: `${SHOTS}/P-access.png` });
    password = 'nueva456';

    // La siguiente consulta de B al servidor ya no tiene sesión: vuelve al inicio de sesión.
    await sell(a, 'cemento', /Cemento gris 25 kg/);
    await expect(b.getByRole('form', { name: 'Iniciar sesión' })).toBeVisible({ timeout: 30_000 });
    await login(b, 'prueba123');
    await expect(b.getByRole('alert')).toHaveText('Usuario o contraseña incorrectos');
    await b.getByLabel('Contraseña', { exact: true }).fill(password);
    await b.getByRole('button', { name: 'Entrar' }).click();
    await expect(b.getByTestId('connection')).toHaveText('Conectado al servidor');

    // Cerrar sesión.
    await a.getByTestId('header').getByRole('button', { name: new RegExp(USER) }).click();
    await a.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
    await expect(a.getByRole('form', { name: 'Iniciar sesión' })).toBeVisible();
    await a.goto(`${URL}/#/sales`);
    await expect(a.getByRole('form', { name: 'Iniciar sesión' })).toBeVisible();
  });
});
