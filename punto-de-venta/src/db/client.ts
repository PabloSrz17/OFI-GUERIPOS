import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Database } from './database';
import { LATEST_VERSION } from './migrations';
import { setConnection } from './connection';
import { detectServer, httpTransport, SyncClient } from './sync-client';
import type { AuthInfo } from './sync-protocol';
import { ensureBaseData } from '@/repos/bootstrap';

/**
 * Base de la app. Si la página la sirve el Servidor POS, los datos viven allá y esta ventana trabaja con una copia
 * sincronizada (D30). Si no (desarrollo, o una sola PC sin servidor), la base es SQLite (sql.js) guardada en
 * IndexedDB después de cada transacción confirmada.
 */
const IDB_NAME = 'pos-local';
const IDB_STORE = 'sqlite';
const IDB_KEY = 'main.sqlite';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadBytes(): Promise<Uint8Array | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result ? new Uint8Array(req.result as ArrayBuffer) : undefined);
    req.onerror = () => reject(req.error);
  });
}

async function saveBytes(bytes: Uint8Array) {
  const db = await idb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(IDB_STORE, 'readwrite');
    t.objectStore(IDB_STORE).put(bytes.slice().buffer, IDB_KEY);
    // "complete" garantiza que IndexedDB ya escribió el dato de forma durable.
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** El Servidor POS pide iniciar sesión (o crear el primer usuario) antes de abrir los datos. */
export class LoginRequired extends Error {
  constructor(readonly auth: AuthInfo) {
    super('Inicia sesión para continuar');
  }
}

let sqlStatic: Promise<SqlJsStatic> | null = null;
export const getSql = () => (sqlStatic ??= initSqlJs({ locateFile: () => wasmUrl }));

let instance: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!instance) {
    instance = (async () => {
      const SQL = await getSql();
      const info = await detectServer();
      let db: Database;
      if (info) {
        if (info.auth && !info.auth.user) throw new LoginRequired(info.auth);
        if (info.schema !== LATEST_VERSION)
          throw new Error(`Esta ventana tiene otra versión del punto de venta que el servidor (base v${info.schema}, app v${LATEST_VERSION}). Recarga la página con Ctrl+F5.`);
        const sync = new SyncClient(httpTransport());
        const bytes = await sync.load().catch(() => {
          throw new Error('No se pudo conectar con el Servidor POS. Revisa que la PC servidor esté encendida y recarga la página.');
        });
        db = new Database(new SQL.Database(bytes), undefined, { migrate: false, remote: sync, factory: (b) => new SQL.Database(b) });
        setConnection({ mode: 'server', status: 'online', user: info.auth?.user ?? null, home: info.home ?? null });
        sync.onStatus((status) => setConnection({ status }));
        sync.start(db);
      } else {
        db = new Database(new SQL.Database(await loadBytes()), saveBytes, { factory: (b) => new SQL.Database(b) });
        setConnection({ mode: 'local', status: 'online' });
      }
      await db.write(ensureBaseData);
      if (import.meta.env.DEV) {
        // Herramientas de desarrollo (pruebas e2e y capturas): nunca se incluyen en producción.
        const dev = await import('./dev-tools');
        (window as unknown as { __posDev: unknown }).__posDev = dev.createDevTools(db);
      }
      return db;
    })();
  }
  return instance;
}
