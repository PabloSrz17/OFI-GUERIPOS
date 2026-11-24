import type { Database as SqlJsDatabase, SqlValue } from 'sql.js';
import { migrate } from './migrations';
import { decodeParams, encodeParams, type Change, type Statement } from './sync-protocol';

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

/**
 * Enlace con el Servidor POS (D30). `commit` envía las sentencias de una transacción; si el servidor avanzó,
 * devuelve los cambios que faltan (o pide recargar todo) y la transacción se vuelve a calcular.
 */
export interface RemoteLink {
  commit(statements: Statement[]): Promise<{ ok: true } | { ok: false; changes: Change[] } | { ok: false; reset: Uint8Array }>;
}

export interface DatabaseOptions {
  /** Aplicar migraciones al abrir (no en modo servidor: la base ya llega migrada). */
  migrate?: boolean;
  remote?: RemoteLink;
  /** Crea una base desde bytes (para reemplazarla al restaurar o al recargar desde el servidor). */
  factory?: (bytes: Uint8Array) => SqlJsDatabase;
}

export function normalizeParams(params?: Params) {
  if (!params) return undefined;
  const conv = (v: SqlValue | boolean | undefined): SqlValue => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  if (Array.isArray(params)) return params.map(conv);
  const out: Record<string, SqlValue> = {};
  for (const [k, v] of Object.entries(params)) out[k.startsWith(':') || k.startsWith('$') || k.startsWith('@') ? k : `:${k}`] = conv(v);
  return out;
}

const MAX_RETRIES = 8;

export class Database {
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private tx: Tx;
  /** Sentencias de la transacción en curso (solo en modo servidor). */
  private capture: Statement[] | null = null;
  private remote?: RemoteLink;

  constructor(
    private db: SqlJsDatabase,
    private readonly persist?: PersistFn,
    private readonly options: DatabaseOptions = {},
  ) {
    this.remote = options.remote;
    this.pragmas();
    this.tx = {
      run: (sql, params) => {
        const p = normalizeParams(params);
        this.db.run(sql, p as never);
        this.capture?.push({ sql, params: encodeParams(p) });
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
    if (options.migrate !== false) migrate(this.db);
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

  private notify() {
    this.listeners.forEach((l) => l());
  }

  read<T>(fn: (q: Tx) => T): Promise<T> {
    return this.enqueue(() => fn(this.tx));
  }

  /**
   * Transacción atómica: BEGIN → fn → COMMIT; ante cualquier error, ROLLBACK y se relanza.
   * Resuelve solo cuando los datos ya quedaron persistidos (en esta PC o en el servidor), para que la UI nunca
   * confirme algo que se pueda perder.
   */
  write<T>(fn: (tx: Tx) => T): Promise<T> {
    return this.enqueue(async () => {
      if (this.remote) return this.writeRemote(fn);
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
      this.notify();
      return result;
    });
  }

  /**
   * Modo servidor: la transacción se calcula aquí, se deshace y sus sentencias se mandan al servidor. Solo si el
   * servidor las acepta se aplican en esta copia. Si otra PC escribió antes, se aplican sus cambios y se vuelve a
   * calcular (con los datos nuevos: folios, stock y caja quedan correctos).
   */
  private async writeRemote<T>(fn: (tx: Tx) => T): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const captured: Statement[] = [];
      this.db.run('BEGIN IMMEDIATE;');
      this.capture = captured;
      let result: T;
      try {
        result = fn(this.tx);
      } finally {
        this.capture = null;
        this.db.run('ROLLBACK;');
      }
      if (captured.length === 0) return result;
      const r = await this.remote!.commit(captured);
      if (r.ok) {
        this.applyUnlocked([captured]);
        return result;
      }
      if ('reset' in r) this.replaceUnlocked(r.reset);
      else this.applyUnlocked(r.changes.map((c) => c.statements));
      if (attempt >= MAX_RETRIES) throw new Error('Hay muchas operaciones al mismo tiempo; intenta de nuevo');
    }
  }

  private applyUnlocked(batches: Statement[][]) {
    if (batches.length === 0) return;
    this.db.run('BEGIN IMMEDIATE;');
    try {
      for (const b of batches) for (const s of b) this.db.run(s.sql, decodeParams(s.params) as never);
      this.db.run('COMMIT;');
    } catch (err) {
      this.db.run('ROLLBACK;');
      throw err;
    }
    this.notify();
  }

  private replaceUnlocked(bytes: Uint8Array) {
    if (!this.options.factory) throw new Error('No se puede recargar la base');
    const old = this.db;
    this.db = this.options.factory(bytes);
    old.close();
    this.pragmas();
    if (this.options.migrate !== false) migrate(this.db);
    this.notify();
  }

  /**
   * Cambios que llegan del servidor (otras PCs). El trabajo corre dentro de la cola, así que puede decidir con la
   * versión actual qué aplicar (y no repetir lo que una escritura propia ya trajo).
   */
  syncJob(job: (ops: { apply(changes: Change[]): void; replace(bytes: Uint8Array): void }) => void) {
    return this.enqueue(() =>
      job({
        apply: (changes) => this.applyUnlocked(changes.map((c) => c.statements)),
        replace: (bytes) => this.replaceUnlocked(bytes),
      }),
    );
  }

  /** Sustituye toda la base (restaurar un respaldo o recargar desde el servidor). En modo local también la persiste. */
  replace(bytes: Uint8Array) {
    return this.enqueue(async () => {
      this.replaceUnlocked(bytes);
      if (this.persist && !this.remote) {
        const b = this.db.export();
        this.pragmas();
        await this.persist(b);
      }
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

  get isRemote() {
    return !!this.remote;
  }

  close() {
    this.db.close();
  }
}
