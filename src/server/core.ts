import type { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';
import { Database, normalizeParams, type Params, type Tx } from '@/db/database';
import { LATEST_VERSION } from '@/db/migrations';
import { decodeParams, encodeParams, isAllowedStatement, type Change, type ChangesResponse, type CommitResponse, type Statement } from '@/db/sync-protocol';
import { ensureBaseData } from '@/repos/bootstrap';

/**
 * Núcleo del Servidor POS (D30), sin red: guarda la base, aplica las escrituras de las PCs en orden y les avisa de
 * los cambios. La versión sube con cada escritura aceptada; el "epoch" cambia al arrancar o restaurar, y entonces
 * las PCs recargan la base completa.
 */
export interface CoreOptions {
  SQL: SqlJsStatic;
  bytes?: Uint8Array | null;
  /** Guarda la base en disco; la escritura se confirma a la PC solo después. */
  persist: (bytes: Uint8Array) => Promise<void> | void;
  /** Cuántos cambios se guardan en memoria para ponerse al día (más atrás, recarga completa). */
  logSize?: number;
}

export class InvalidBackupError extends Error {}
/** Petición mal formada o con sentencias no permitidas. */
export class BadRequestError extends Error {}

const randomEpoch = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export class ServerCore {
  private db!: SqlJsDatabase;
  epoch = randomEpoch();
  version = 0;
  private log: Change[] = [];
  private waiters = new Set<() => void>();
  private chain: Promise<unknown> = Promise.resolve();
  private readonly logSize: number;

  private constructor(private readonly opts: CoreOptions) {
    this.logSize = opts.logSize ?? 5000;
  }

  static async open(opts: CoreOptions) {
    const core = new ServerCore(opts);
    core.db = await core.prepare(opts.bytes ?? undefined);
    await opts.persist(core.exportBytes());
    return core;
  }

  /** Abre unos bytes (o una base nueva), migra y crea los datos base. */
  private async prepare(bytes?: Uint8Array) {
    const raw = new this.opts.SQL.Database(bytes);
    const wrapper = new Database(raw); // aplica migraciones
    await wrapper.write(ensureBaseData);
    raw.run('PRAGMA foreign_keys = ON;');
    return raw;
  }

  private exportBytes() {
    const b = this.db.export();
    this.db.run('PRAGMA foreign_keys = ON;');
    return b;
  }

  /** Las escrituras y restauraciones van en fila: nunca dos a la vez. */
  private serial<T>(job: () => Promise<T> | T): Promise<T> {
    const next = this.chain.then(job, job);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private wake() {
    const ws = [...this.waiters];
    this.waiters.clear();
    ws.forEach((w) => w());
  }

  info() {
    return { pos: true as const, epoch: this.epoch, version: this.version, schema: LATEST_VERSION };
  }

  snapshot() {
    return this.serial(() => ({ epoch: this.epoch, version: this.version, bytes: this.exportBytes() }));
  }

  private since(version: number): Change[] | null {
    if (version === this.version) return [];
    const oldest = this.log[0]?.version ?? this.version + 1;
    if (version < oldest - 1 || version > this.version) return null;
    return this.log.filter((c) => c.version > version);
  }

  changes(epoch: string, since: number): ChangesResponse {
    if (epoch !== this.epoch) return { reset: true };
    const c = this.since(since);
    return c === null ? { reset: true } : { reset: false, version: this.version, changes: c };
  }

  /** Espera (long polling) hasta que haya algo nuevo o se cumpla el tiempo. */
  async waitChanges(epoch: string, since: number, timeoutMs: number): Promise<ChangesResponse> {
    const now = this.changes(epoch, since);
    if (now.reset || now.changes.length) return now;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t);
        this.waiters.delete(done);
        resolve();
      };
      const t = setTimeout(done, timeoutMs);
      this.waiters.add(done);
    });
    return this.changes(epoch, since);
  }

  commit(epoch: string, base: number, statements: Statement[]): Promise<CommitResponse> {
    return this.serial(async () => {
      if (epoch !== this.epoch) return { ok: false as const, reason: 'reset' as const };
      if (base !== this.version) {
        const c = this.since(base);
        return c === null ? { ok: false as const, reason: 'reset' as const } : { ok: false as const, reason: 'conflict' as const, changes: c, version: this.version };
      }
      if (!Array.isArray(statements) || statements.length === 0) throw new BadRequestError('Escritura vacía');
      for (const s of statements) if (typeof s?.sql !== 'string' || !isAllowedStatement(s.sql)) throw new BadRequestError('Sentencia no permitida');
      this.db.run('BEGIN IMMEDIATE;');
      try {
        for (const s of statements) this.db.run(s.sql, decodeParams(s.params) as never);
        this.db.run('COMMIT;');
      } catch (e) {
        this.db.run('ROLLBACK;');
        throw e;
      }
      await this.opts.persist(this.exportBytes());
      this.version += 1;
      this.log.push({ version: this.version, statements });
      if (this.log.length > this.logSize) this.log.splice(0, this.log.length - this.logSize);
      this.wake();
      return { ok: true as const, version: this.version };
    });
  }

  backup() {
    return this.serial(() => this.exportBytes());
  }

  /**
   * Restaurar: valida que el archivo sea una base del POS, la actualiza a la versión actual y la pone en lugar de
   * la que hay. Todas las PCs recargan. Devuelve los bytes anteriores para guardarlos como respaldo previo.
   */
  restore(bytes: Uint8Array) {
    return this.serial(async () => {
      validateBackup(this.opts.SQL, bytes);
      const previous = this.exportBytes();
      const next = await this.prepare(bytes);
      this.db.close();
      this.db = next;
      this.epoch = randomEpoch();
      this.version = 0;
      this.log = [];
      await this.opts.persist(this.exportBytes());
      this.wake();
      return previous;
    });
  }

  /** Acceso tipo transacción a la base del servidor; con capture anota las escrituras (sentencias para las PCs). */
  private txOf(capture?: Statement[]): Tx {
    const db = this.db;
    const tx: Tx = {
      run: (sql, params) => {
        const p = normalizeParams(params);
        db.run(sql, p as never);
        capture?.push({ sql, params: encodeParams(p) });
      },
      all: <T>(sql: string, params?: Params) => {
        const stmt = db.prepare(sql);
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
      get: <T>(sql: string, params?: Params) => tx.all<T>(sql, params)[0],
    };
    return tx;
  }

  /** Lectura con los repositorios del POS (la usa la Oficina Virtual, D42). */
  read<T>(fn: (tx: Tx) => T): Promise<T> {
    return this.serial(() => fn(this.txOf()));
  }

  /**
   * Escritura hecha en el propio servidor (D42: la Oficina Virtual registra un retiro de caja). Igual que una de las
   * PCs: se aplica en una transacción, se guarda y las PCs reciben las mismas sentencias.
   */
  writeLocal<T>(fn: (tx: Tx) => T): Promise<T> {
    return this.serial(async () => {
      const statements: Statement[] = [];
      this.db.run('BEGIN IMMEDIATE;');
      let result: T;
      try {
        result = fn(this.txOf(statements));
        this.db.run('COMMIT;');
      } catch (e) {
        this.db.run('ROLLBACK;');
        throw e;
      }
      if (!statements.length) return result;
      await this.opts.persist(this.exportBytes());
      this.version += 1;
      this.log.push({ version: this.version, statements });
      if (this.log.length > this.logSize) this.log.splice(0, this.log.length - this.logSize);
      this.wake();
      return result;
    });
  }

  /** Lectura directa (estado del servidor, pruebas). */
  query<T>(sql: string): T[] {
    const r = this.db.exec(sql)[0];
    if (!r) return [];
    return r.values.map((v) => Object.fromEntries(r.columns.map((c, i) => [c, v[i]])) as T);
  }
}

/** Un respaldo válido es una base SQLite con las tablas del POS y una versión de esquema conocida. */
export function validateBackup(SQL: SqlJsStatic, bytes: Uint8Array) {
  const header = new TextDecoder().decode(bytes.slice(0, 15));
  if (header !== 'SQLite format 3') throw new InvalidBackupError('El archivo no es un respaldo del punto de venta');
  let db: SqlJsDatabase | null = null;
  try {
    db = new SQL.Database(bytes);
    const v = db.exec('SELECT max(version) FROM schema_migrations')[0]?.values[0]?.[0];
    const tables = (db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values ?? []).map((r) => r[0]);
    if (typeof v !== 'number' || !['products', 'sales'].every((t) => tables.includes(t))) throw new Error();
    if (v > LATEST_VERSION) throw new InvalidBackupError('El respaldo es de una versión más nueva del punto de venta');
    return { schema: v };
  } catch (e) {
    if (e instanceof InvalidBackupError) throw e;
    throw new InvalidBackupError('El archivo no es un respaldo del punto de venta');
  } finally {
    db?.close();
  }
}

