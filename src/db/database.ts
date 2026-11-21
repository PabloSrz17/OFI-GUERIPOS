import type { Database as SqlJsDatabase, SqlValue } from 'sql.js';
import { migrate } from './migrations';

export type Params = Record<string, SqlValue | boolean | undefined> | (SqlValue | boolean | undefined)[];
export type Row = Record<string, SqlValue>;

/**
 * Acceso dentro de una lectura o transacción. Es síncrono a propósito: con sql.js ninguna otra
 * operación puede intercalarse entre dos sentencias, así que cada `write` es atómico por construcción.
 */
export interface Tx {
  run(sql: string, params?: Params): void;
  all<T = Row>(sql: string, params?: Params): T[];
  get<T = Row>(sql: string, params?: Params): T | undefined;
}

/** Guarda la imagen completa de la base tras cada transacción confirmada (IndexedDB, archivo en Tauri…). */
export type PersistFn = (bytes: Uint8Array) => Promise<void>;

function normalizeParams(params?: Params) {
  if (!params) return undefined;
  const conv = (v: SqlValue | boolean | undefined): SqlValue => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  if (Array.isArray(params)) return params.map(conv);
  const out: Record<string, SqlValue> = {};
  for (const [k, v] of Object.entries(params)) out[k.startsWith(':') || k.startsWith('$') || k.startsWith('@') ? k : `:${k}`] = conv(v);
  return out;
}

export class Database {
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private tx: Tx;

  constructor(
    private readonly db: SqlJsDatabase,
    private readonly persist?: PersistFn,
  ) {
    this.pragmas();
    this.tx = {
      run: (sql, params) => {
        this.db.run(sql, normalizeParams(params) as never);
      },
      all: <T>(sql: string, params?: Params) => {
        const stmt = this.db.prepare(sql);
        try {
          const p = normalizeParams(params);
          if (p) stmt.bind(p as never);
          const rows: T[] = [];
          while (stmt.step()) rows.push(stmt.getAsObject() as T);
          return rows;
        } finally {
          stmt.free();
        }
      },
      get: <T>(sql: string, params?: Params) => this.tx.all<T>(sql, params)[0],
    };
    migrate(this.db);
  }

  private pragmas() {
    // sql.js restablece los PRAGMA al exportar; por eso se vuelven a aplicar después de cada export().
    this.db.run('PRAGMA foreign_keys = ON;');
  }

  /** Serializa todas las operaciones (lecturas incluidas) en una sola cola. */
  private enqueue<T>(job: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined);
    return next;
  }

  read<T>(fn: (q: Tx) => T): Promise<T> {
    return this.enqueue(() => fn(this.tx));
  }

  /**
   * Transacción atómica: BEGIN → fn → COMMIT; ante cualquier error, ROLLBACK y se relanza.
   * Resuelve solo cuando los datos ya quedaron persistidos, para que la UI nunca confirme algo que se pueda perder.
   */
  write<T>(fn: (tx: Tx) => T): Promise<T> {
    return this.enqueue(async () => {
      this.db.run('BEGIN IMMEDIATE;');
      let result: T;
      try {
        result = fn(this.tx);
        this.db.run('COMMIT;');
      } catch (err) {
        this.db.run('ROLLBACK;');
        throw err;
      }
      if (this.persist) {
        const bytes = this.db.export();
        this.pragmas();
        await this.persist(bytes);
      }
      this.listeners.forEach((l) => l());
      return result;
    });
  }

  /** Avisa de cada transacción confirmada (las vistas vuelven a consultar). */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  export() {
    return this.enqueue(() => {
      const bytes = this.db.export();
      this.pragmas();
      return bytes;
    });
  }

  close() {
    this.db.close();
  }
}
