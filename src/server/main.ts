/**
 * Servidor POS (D30–D32). Corre en la PC servidor: guarda la base en `datos/pos.sqlite`, sirve la app a las PCs de
 * la red, recibe sus escrituras y hace un respaldo automático diario en `respaldos/`.
 *
 * Uso: `ServidorPOS.exe` (o `node servidor.cjs`). Variables opcionales: POS_PORT (8420), POS_HOME (carpeta base).
 * `ServidorPOS.exe --restablecer-acceso` borra usuarios y sesiones (el acceso se vuelve a crear desde esta PC).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, openSync, writeSync, fsyncSync, closeSync, appendFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import initSqlJs from 'sql.js';
import { BadRequestError, InvalidBackupError, ServerCore } from './core';
import { escpos, type TicketLine } from '../print/escpos';
import { listPrinters, printRaw, warmUpPrinter } from './printer';
import { getSale, type SaleDetail } from '@/repos/sales';
import { addCashFlow } from '@/repos/cash';
import { AccessStore, AuthError, clearCookie, readCookie, sessionCookie, type AccessData, type StoredUser } from './auth';

const isSea = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node:sea').isSea();
  } catch {
    return false;
  }
})();
/** Carpeta del programa (app y motor) y carpeta de datos (por defecto, la misma). */
const BASE = isSea ? dirname(process.execPath) : __dirname;
const HOME = resolve(process.env.POS_HOME ?? BASE);
const PORT = Number(process.env.POS_PORT ?? 8420);
/** Ruta donde se abre la app: '/' en el Servidor POS propio, '/pos/' dentro de la Oficina Virtual. */
const PUBLIC_PATH = process.env.POS_PUBLIC_PATH ?? '/';
const DATA_DIR = join(HOME, 'datos');
const DB_FILE = join(DATA_DIR, 'pos.sqlite');
const STATE_FILE = join(DATA_DIR, 'estado.json');
const ACCESS_FILE = join(DATA_DIR, 'acceso.json');
/** Usuario preparado al armar el servidor (solo hash); se usa si todavía no hay ninguno. */
const INITIAL_ACCESS = join(BASE, 'acceso-inicial.json');
const BACKUP_DIR = join(HOME, 'respaldos');
const LOG_FILE = join(HOME, 'servidor.log');
const KEEP_BACKUPS = 30;
const DAY = 86_400_000;

const firstExisting = (...paths: string[]) => paths.find((p) => existsSync(p)) ?? paths[0];
const APP_DIR = firstExisting(join(BASE, 'app'), resolve(process.cwd(), 'dist'));
const WASM = firstExisting(join(BASE, 'sql-wasm.wasm'), resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm'));

function log(msg: string) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    appendFileSync(LOG_FILE, line + '\n');
  } catch {
    /* sin bitácora en disco */
  }
}

/** Escritura durable: archivo temporal, fsync y renombrar (nunca queda una base a medias). */
function writeDurable(path: string, bytes: Uint8Array) {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

interface State {
  lastDownload: string | null;
  lastAutoBackup: string | null;
}
function readState(): State {
  try {
    return { lastDownload: null, lastAutoBackup: null, ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) };
  } catch {
    return { lastDownload: null, lastAutoBackup: null };
  }
}
function saveState(patch: Partial<State>) {
  writeDurable(STATE_FILE, new TextEncoder().encode(JSON.stringify({ ...readState(), ...patch }, null, 2)));
}

const stamp = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

function listBackups() {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.sqlite'))
    .map((name) => {
      const st = statSync(join(BACKUP_DIR, name));
      return { name, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function saveBackup(bytes: Uint8Array, prefix: string) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `${prefix}-${stamp()}.sqlite`;
  writeDurable(join(BACKUP_DIR, name), bytes);
  // Solo se rotan los automáticos; los previos a restaurar se conservan.
  const autos = listBackups().filter((b) => b.name.startsWith('automatico-'));
  for (const old of autos.slice(KEEP_BACKUPS)) unlinkSync(join(BACKUP_DIR, old.name));
  return name;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

/** Valida los renglones del ticket que manda el navegador (D35). */
function parseTicketLines(v: unknown): TicketLine[] {
  if (!Array.isArray(v) || v.length > 2000) throw new BadRequestError('Ticket inválido');
  const s = (x: unknown) => String(x ?? '').slice(0, 2000);
  const parts = (x: unknown) => (Array.isArray(x) ? x.slice(0, 50).map((p: Record<string, unknown>) => ({ text: s(p?.text), bold: !!p?.bold })) : undefined);
  return v.map((l: Record<string, unknown>) => {
    if (l?.type === 'rule') return { type: 'rule' };
    if (l?.type === 'row') return { type: 'row', left: s(l.left), right: s(l.right), leftParts: parts(l.leftParts), rightParts: parts(l.rightParts), bold: !!l.bold, big: !!l.big, tall: !!l.tall };
    if (l?.type === 'text')
      return { type: 'text', text: s(l.text), parts: parts(l.parts), align: l.align === 'center' || l.align === 'right' ? l.align : 'left', bold: !!l.bold, big: !!l.big, tall: !!l.tall };
    throw new BadRequestError('Ticket inválido');
  });
}

/** Direcciones de esta PC en la red local (las que abren las demás PCs). */
function networkUrls() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => `http://${n!.address}:${PORT}${PUBLIC_PATH === '/' ? '' : PUBLIC_PATH}`);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        fail(new BadRequestError('Archivo demasiado grande'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const sendFile = (res: ServerResponse, bytes: Uint8Array, name: string) => {
  res.writeHead(200, { 'content-type': 'application/vnd.sqlite3', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' });
  res.end(Buffer.from(bytes));
};

function serveStatic(res: ServerResponse, urlPath: string) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  let file = join(APP_DIR, clean);
  if (!file.startsWith(APP_DIR + sep) && file !== APP_DIR) return json(res, 403, { error: 'Prohibido' });
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(APP_DIR, 'index.html');
  if (!existsSync(file)) return json(res, 500, { error: `No se encontró la app en ${APP_DIR}` });
  const ext = extname(file);
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable' });
  res.end(readFileSync(file));
}

const readJson = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
};
const isLocalRequest = (req: IncomingMessage) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
/** Un POST solo se acepta desde la propia app (evita que otra página mande órdenes con la sesión del navegador). */
const sameOrigin = (req: IncomingMessage) => {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
};

function openAccess() {
  const access = new AccessStore(readJson<AccessData>(ACCESS_FILE), (d) => writeDurable(ACCESS_FILE, new TextEncoder().encode(JSON.stringify(d, null, 2))));
  if (!access.configured) {
    const initial = readJson<{ users: StoredUser[] }>(INITIAL_ACCESS);
    if (initial && access.importUsers(initial.users ?? [])) log(`Acceso inicial cargado: ${initial.users.map((u) => u.name).join(', ')}`);
  }
  if (!access.configured) log('Todavía no hay usuario: ábrelo en esta PC (http://localhost:' + PORT + ') para crearlo.');
  return access;
}

let serverCore: ServerCore | null = null;
const coreListo = () => {
  if (!serverCore) throw new Error('El Punto de Venta todavía no arranca');
  return serverCore;
};

/** Venta resumida para la Oficina Virtual. */
export interface OficinaVenta {
  id: string;
  folio: number;
  mode: 'sale' | 'order';
  created_at: string;
  deleted_at: string | null;
  source: string | null;
  delivery_method: 'pickup' | 'shipping' | null;
  delivery_status: 'delivered' | 'pending';
  total_cents: number;
}

/** N1316 → 1316; #12 (serie antigua de Pulpos) → -12. */
const folioDe = (texto: string) => {
  const m = String(texto ?? '').trim().toUpperCase().match(/^(N|#)?(\d{1,9})$/);
  return m ? (m[1] === '#' ? -Number(m[2]) : Number(m[2])) : null;
};

/**
 * Lo que la Oficina Virtual (que monta este módulo en su mismo servidor) lee y escribe en el POS (D42): las ventas
 * para el tablero de reparto, los retiros de caja para el control de combustible de Edgar y el retiro que Edgar
 * registra cuando alguien le contesta "sí". Nada sale de esta PC.
 */
export const oficina = {
  ventasDesde: (desdeIso: string) =>
    coreListo().read((tx) =>
      tx.all<OficinaVenta>(
        'SELECT id, folio, mode, created_at, deleted_at, source, delivery_method, delivery_status, total_cents FROM sales WHERE created_at >= ? ORDER BY created_at',
        [desdeIso],
      ),
    ),
  venta: (id: string): Promise<SaleDetail | null> => coreListo().read((tx) => getSale(tx, id)),
  ventaPorFolio: (texto: string): Promise<SaleDetail | null> => {
    const folio = folioDe(texto);
    if (folio === null) return Promise.resolve(null);
    return coreListo().read((tx) => {
      const r = tx.get<{ id: string }>('SELECT id FROM sales WHERE folio = ?', [folio]);
      return r ? getSale(tx, r.id) : null;
    });
  },
  /** Retiros de efectivo (y sus anulaciones) desde una fecha. */
  retirosDesde: (desdeIso: string) =>
    coreListo().read((tx) =>
      tx.all<{ id: string; type: 'cash_out' | 'cash_out_void'; amount_cents: number; description: string; voids_id: string | null; created_at: string }>(
        "SELECT id, type, amount_cents, description, voids_id, created_at FROM cash_movements WHERE type IN ('cash_out', 'cash_out_void') AND created_at >= ? ORDER BY created_at",
        [desdeIso],
      ),
    ),
  /** Retiro de efectivo de la caja (como "Retirar Efectivo" en la pantalla de Caja). Devuelve su id. */
  registrarRetiro: (r: { importeCents: number; motivo: string }) =>
    coreListo().writeLocal((tx) => addCashFlow(tx, { type: 'cash_out', amountCents: r.importeCents, reason: r.motivo }).id),
};

export type PosHandler = (req: IncomingMessage, res: ServerResponse) => Promise<unknown>;

/**
 * Abre la base y devuelve el manejador de pedidos del POS (app + API). Lo usa el Servidor POS propio y también la
 * Oficina Virtual, que lo monta en /pos/ de su mismo servidor (D37): el manejador solo ve la ruta sin ese prefijo.
 */
export async function createPosHandler(): Promise<PosHandler> {
  mkdirSync(DATA_DIR, { recursive: true });
  const access = openAccess();
  const SQL = await initSqlJs({ wasmBinary: readFileSync(WASM) as unknown as ArrayBuffer });
  const existing = existsSync(DB_FILE) ? new Uint8Array(readFileSync(DB_FILE)) : null;
  const core = await ServerCore.open({ SQL, bytes: existing, persist: (b) => writeDurable(DB_FILE, b) });
  serverCore = core;
  log(existing ? `Base abierta: ${DB_FILE}` : `Base nueva creada: ${DB_FILE}`);

  const autoBackup = async (force = false) => {
    const last = readState().lastAutoBackup;
    if (!force && last && Date.now() - new Date(last).getTime() < DAY - 3_600_000) return;
    const name = saveBackup(await core.backup(), 'automatico');
    saveState({ lastAutoBackup: new Date().toISOString() });
    log(`Respaldo automático: ${name}`);
  };
  await autoBackup();
  setInterval(() => void autoBackup().catch((e) => log(`Error en respaldo automático: ${e}`)), 3_600_000).unref();

  log(`Datos: ${DATA_DIR}  Respaldos: ${BACKUP_DIR}`);
  warmUpPrinter();
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      const token = readCookie(req.headers.cookie);
      const user = access.session(token);
      if (req.method === 'POST' && !sameOrigin(req)) return json(res, 403, { error: 'Origen no permitido' });
      const body = async () => JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}') as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' ? v : '');

      if (path === '/api/info') {
        const auth = { configured: access.configured, user, canSetup: !access.configured && isLocalRequest(req) };
        if (!user) return json(res, 200, { pos: true, schema: core.info().schema, auth });
        return json(res, 200, { ...core.info(), ...readState(), auth, urls: networkUrls(), ...(process.env.POS_HOME_URL ? { home: process.env.POS_HOME_URL } : {}) });
      }
      if (path === '/api/login' && req.method === 'POST') {
        const b = await body();
        const r = access.login(str(b.user), str(b.password), req.socket.remoteAddress ?? '?');
        log(`Inicio de sesión: ${r.user} desde ${req.socket.remoteAddress}`);
        res.setHeader('set-cookie', sessionCookie(r.token));
        return json(res, 200, { ok: true, user: r.user });
      }
      if (path === '/api/setup' && req.method === 'POST') {
        if (!isLocalRequest(req)) throw new AuthError('El usuario se crea desde la PC servidor (http://localhost:' + PORT + ')', 403);
        const b = await body();
        const t = access.setup(str(b.user).trim(), str(b.password));
        log(`Acceso creado: ${str(b.user).trim()}`);
        res.setHeader('set-cookie', sessionCookie(t));
        return json(res, 200, { ok: true, user: str(b.user).trim() });
      }
      if (path === '/api/logout' && req.method === 'POST') {
        access.logout(token);
        res.setHeader('set-cookie', clearCookie());
        return json(res, 200, { ok: true });
      }
      if (path.startsWith('/api/') && !user) return json(res, 401, { error: 'Inicia sesión para continuar' });
      if (path === '/api/password' && req.method === 'POST') {
        const b = await body();
        access.changePassword(token!, str(b.current), str(b.next));
        log(`Contraseña cambiada: ${user}`);
        return json(res, 200, { ok: true });
      }
      if (path === '/api/printers') return json(res, 200, await listPrinters());
      if (path === '/api/print' && req.method === 'POST') {
        const b = JSON.parse((await readBody(req, 512 * 1024)).toString('utf8') || '{}') as Record<string, unknown>;
        const printer = str(b.printer);
        if (!printer) throw new BadRequestError('Elige la impresora de tickets en Preferencias → Tickets');
        const lines = parseTicketLines(b.lines);
        // Varias copias en un solo trabajo, cada una con su corte.
        const one = escpos(lines, { columns: Number(b.columns) || 48, cut: b.cut !== false });
        const copies = Math.max(1, Math.min(5, Math.round(Number(b.copies)) || 1));
        const bytes = new Uint8Array(one.length * copies);
        for (let i = 0; i < copies; i++) bytes.set(one, i * one.length);
        await printRaw(printer, bytes);
        return json(res, 200, { ok: true });
      }
      if (path === '/api/snapshot') {
        const s = await core.snapshot();
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-pos-epoch': s.epoch, 'x-pos-version': String(s.version), 'cache-control': 'no-store' });
        return res.end(Buffer.from(s.bytes));
      }
      if (path === '/api/changes') {
        const r = await core.waitChanges(url.searchParams.get('epoch') ?? '', Number(url.searchParams.get('since') ?? 0), 25_000);
        return json(res, 200, r);
      }
      if (path === '/api/commit' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 20 * 1024 * 1024)).toString('utf8'));
        const r = await core.commit(String(body.epoch), Number(body.base), body.statements);
        return json(res, r.ok ? 200 : 409, r);
      }
      if (path === '/api/backup') {
        const bytes = await core.backup();
        saveState({ lastDownload: new Date().toISOString() });
        log('Respaldo descargado');
        return sendFile(res, bytes, `respaldo-pos-${stamp()}.sqlite`);
      }
      if (path === '/api/backups') return json(res, 200, listBackups());
      if (path.startsWith('/api/backups/')) {
        const name = decodeURIComponent(path.slice('/api/backups/'.length));
        if (!/^[\w.-]+\.sqlite$/.test(name) || !existsSync(join(BACKUP_DIR, name))) return json(res, 404, { error: 'No existe ese respaldo' });
        return sendFile(res, readFileSync(join(BACKUP_DIR, name)), name);
      }
      if (path === '/api/restore' && req.method === 'POST') {
        const bytes = new Uint8Array(await readBody(req, 500 * 1024 * 1024));
        const previous = await core.restore(bytes);
        const name = saveBackup(previous, 'antes-de-restaurar');
        log(`Respaldo restaurado. La base anterior quedó en ${name}`);
        return json(res, 200, { ok: true, previous: name });
      }
      if (path.startsWith('/api/')) return json(res, 404, { error: 'No encontrado' });
      return serveStatic(res, path);
    } catch (e) {
      if (e instanceof AuthError) return json(res, e.status, { error: e.message });
      const known = e instanceof BadRequestError || e instanceof InvalidBackupError || e instanceof SyntaxError;
      if (!known) log(`Error en ${req.method} ${path}: ${e instanceof Error ? e.stack : e}`);
      return json(res, known ? 400 : 500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

async function main() {
  if (process.argv.includes('--restablecer-acceso')) {
    mkdirSync(DATA_DIR, { recursive: true });
    if (existsSync(ACCESS_FILE)) unlinkSync(ACCESS_FILE);
    log('Acceso restablecido: se borraron usuarios y sesiones. Abre http://localhost:' + PORT + ' en esta PC para crear el usuario.');
    return;
  }
  const handler = await createPosHandler();
  const server = createServer((req, res) => void handler(req, res));
  server.requestTimeout = 0; // el long polling dura hasta 25 s
  server.listen(PORT, '0.0.0.0', () => {
    const ips = networkUrls();
    log(`Servidor POS listo. En esta PC: http://localhost:${PORT}  En la red: ${ips.join('  ') || '(sin red)'}`);
  });
  server.on('error', (e) => {
    log(`No se pudo iniciar el servidor: ${e.message}${(e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? ` (el puerto ${PORT} ya está en uso: ¿ya está abierto el Servidor POS?)` : ''}`);
    process.exit(1);
  });
}

// Dentro de la Oficina Virtual (pos-modulo.cjs) el servidor lo pone ella: no se arranca uno propio.
declare const __POS_EMBEDDED__: boolean | undefined;
if (typeof __POS_EMBEDDED__ === 'undefined' || !__POS_EMBEDDED__)
  main().catch((e) => {
    log(`Error al arrancar: ${e instanceof Error ? e.stack : e}`);
    process.exit(1);
  });
