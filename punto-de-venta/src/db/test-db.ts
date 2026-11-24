import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { Database } from './database';
import { ensureBaseData } from '@/repos/bootstrap';

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

/** Base en memoria para pruebas (sin persistencia), con los datos base ya creados. */
export async function createTestDb(persist?: (bytes: Uint8Array) => Promise<void>) {
  SQL ??= await initSqlJs({ wasmBinary: readFileSync(resolve('node_modules/sql.js/dist/sql-wasm.wasm')) as unknown as ArrayBuffer });
  const db = new Database(new SQL.Database(), persist);
  await db.write(ensureBaseData);
  return db;
}

export async function openTestDb(bytes: Uint8Array) {
  SQL ??= await initSqlJs({ wasmBinary: readFileSync(resolve('node_modules/sql.js/dist/sql-wasm.wasm')) as unknown as ArrayBuffer });
  return new Database(new SQL.Database(bytes));
}
