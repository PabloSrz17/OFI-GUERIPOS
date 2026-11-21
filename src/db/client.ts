import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Database } from './database';
import { ensureBaseData } from '@/repos/bootstrap';

/**
 * Base local del navegador / ventana de Tauri: SQLite (sql.js) cuya imagen se guarda en IndexedDB
 * después de cada transacción confirmada. Ver decisions.md D4 para el paso al archivo nativo.
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

let instance: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!instance) {
    instance = (async () => {
      const SQL = await initSqlJs({ locateFile: () => wasmUrl });
      const bytes = await loadBytes();
      const db = new Database(new SQL.Database(bytes), saveBytes);
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
