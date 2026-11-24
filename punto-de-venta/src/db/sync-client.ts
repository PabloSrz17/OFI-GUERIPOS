import type { Database, RemoteLink } from './database';
import type { ChangesResponse, CommitResponse, ServerInfo, Statement } from './sync-protocol';

/** Cómo habla una PC con el servidor (HTTP en la app; directo al núcleo en las pruebas). */
export interface Transport {
  snapshot(): Promise<{ epoch: string; version: number; bytes: Uint8Array }>;
  commit(epoch: string, base: number, statements: Statement[]): Promise<CommitResponse>;
  changes(epoch: string, since: number): Promise<ChangesResponse>;
}

export class OfflineError extends Error {
  constructor() {
    super('Sin conexión con el servidor: no se guardó. Revisa que la PC servidor esté encendida y en la red.');
  }
}

export type ConnectionStatus = 'online' | 'offline';

/**
 * Lado de la PC (D30): manda las escrituras, escucha los cambios de las demás PCs y lleva la versión.
 * Sin conexión, las lecturas siguen funcionando con la última copia y las escrituras fallan con OfflineError.
 */
export class SyncClient implements RemoteLink {
  epoch = '';
  version = 0;
  status: ConnectionStatus = 'online';
  private db: Database | null = null;
  private stopped = false;
  private listeners = new Set<(s: ConnectionStatus) => void>();

  constructor(
    private readonly transport: Transport,
    private readonly retryMs = 2000,
  ) {}

  /** Descarga la base completa para arrancar. */
  async load() {
    const s = await this.transport.snapshot();
    this.epoch = s.epoch;
    this.version = s.version;
    return s.bytes;
  }

  onStatus(l: (s: ConnectionStatus) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private setStatus(s: ConnectionStatus) {
    if (s === this.status) return;
    this.status = s;
    this.listeners.forEach((l) => l(s));
  }

  async commit(statements: Statement[]) {
    let r: CommitResponse;
    try {
      r = await this.transport.commit(this.epoch, this.version, statements);
    } catch {
      this.setStatus('offline');
      throw new OfflineError();
    }
    this.setStatus('online');
    if (r.ok) {
      this.version = r.version;
      return { ok: true as const };
    }
    if (r.reason === 'conflict') {
      this.version = r.version;
      return { ok: false as const, changes: r.changes };
    }
    const bytes = await this.load().catch(() => {
      this.setStatus('offline');
      throw new OfflineError();
    });
    return { ok: false as const, reset: bytes };
  }

  /** Escucha cambios hasta `stop()`. Cada respuesta se aplica dentro de la cola de la base. */
  start(db: Database) {
    this.attach(db);
    void this.loop();
  }

  /** Une la base sin arrancar la escucha (las pruebas llaman a pollOnce). */
  attach(db: Database) {
    this.db = db;
  }

  stop() {
    this.stopped = true;
  }

  /** Una vuelta de escucha (las pruebas la llaman directo). */
  async pollOnce() {
    const db = this.db!;
    const r = await this.transport.changes(this.epoch, this.version);
    this.setStatus('online');
    if (r.reset) {
      const snap = await this.transport.snapshot();
      await db.syncJob(({ replace }) => {
        // Si mientras tanto una escritura propia ya trajo algo más nuevo de este mismo epoch, no se retrocede.
        if (snap.epoch === this.epoch && snap.version <= this.version) return;
        replace(snap.bytes);
        this.epoch = snap.epoch;
        this.version = snap.version;
      });
      return;
    }
    if (r.changes.length === 0) return;
    await db.syncJob(({ apply }) => {
      const fresh = r.changes.filter((c) => c.version > this.version);
      if (fresh.length === 0) return;
      if (fresh[0].version !== this.version + 1) {
        // Hueco en la secuencia: se fuerza recargar en la siguiente vuelta.
        this.epoch = '';
        return;
      }
      apply(fresh);
      this.version = fresh[fresh.length - 1].version;
    });
  }

  private async loop() {
    while (!this.stopped) {
      try {
        await this.pollOnce();
      } catch {
        if (this.stopped) return;
        this.setStatus('offline');
        await new Promise((r) => setTimeout(r, this.retryMs));
      }
    }
  }
}

let onUnauthorized = () => {
  if (typeof window !== 'undefined') window.location.reload();
};
/** Para pruebas: qué hacer cuando el servidor pide iniciar sesión. */
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

const withTimeout = async (url: string, init: RequestInit, ms: number) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
    // La sesión se cerró o venció (otra PC cambió la contraseña, o se restableció el acceso): de vuelta al inicio de sesión.
    if (res.status === 401 && !url.endsWith('/api/info')) onUnauthorized();
    if (!res.ok && res.status !== 409) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    return res;
  } finally {
    clearTimeout(t);
  }
};

/** Transporte HTTP contra el Servidor POS (mismo origen que la página). */
export const httpTransport = (base = '.'): Transport => ({
  async snapshot() {
    const res = await withTimeout(`${base}/api/snapshot`, {}, 60_000);
    return { epoch: res.headers.get('x-pos-epoch') ?? '', version: Number(res.headers.get('x-pos-version') ?? 0), bytes: new Uint8Array(await res.arrayBuffer()) };
  },
  async commit(epoch, base_, statements) {
    const res = await withTimeout(`${base}/api/commit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ epoch, base: base_, statements }) }, 20_000);
    return (await res.json()) as CommitResponse;
  },
  async changes(epoch, since) {
    const res = await withTimeout(`${base}/api/changes?epoch=${encodeURIComponent(epoch)}&since=${since}`, {}, 40_000);
    return (await res.json()) as ChangesResponse;
  },
});

/** ¿La página la sirve un Servidor POS? (si no, se trabaja con la base local del navegador). */
export async function detectServer(base = '.'): Promise<ServerInfo | null> {
  try {
    const res = await withTimeout(`${base}/api/info`, {}, 4000);
    const info = (await res.json()) as ServerInfo;
    return info?.pos ? info : null;
  } catch {
    return null;
  }
}
