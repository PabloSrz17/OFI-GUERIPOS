// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { Database } from '@/db/database';
import { OfflineError, SyncClient, type Transport } from '@/db/sync-client';
import { isAllowedStatement } from '@/db/sync-protocol';
import { listPriceLists } from '@/repos/categories';
import { createClient } from '@/repos/clients';
import { createCollection } from '@/repos/collections';
import { createProduct } from '@/repos/products';
import { createSale } from '@/repos/sales';
import { addCashFlow } from '@/repos/cash';
import { BadRequestError, InvalidBackupError, ServerCore } from './core';

let SQL: SqlJsStatic;
let core: ServerCore;
let disk: Uint8Array | null;

beforeAll(async () => {
  SQL = await initSqlJs({ wasmBinary: readFileSync(resolve('node_modules/sql.js/dist/sql-wasm.wasm')) as unknown as ArrayBuffer });
});
beforeEach(async () => {
  disk = null;
  core = await ServerCore.open({ SQL, persist: (b) => void (disk = b) });
});

/** Una PC conectada al núcleo. `net.down` simula la red caída; `net.loseReply` aplica en el servidor pero pierde la respuesta. */
async function pc() {
  const net = { down: false, loseReply: false };
  const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const transport: Transport = {
    snapshot: async () => {
      if (net.down) throw new Error('red');
      return core.snapshot();
    },
    commit: async (e, b, s) => {
      if (net.down) throw new Error('red');
      const r = await core.commit(e, b, wire(s));
      if (net.loseReply) {
        net.loseReply = false;
        throw new Error('respuesta perdida');
      }
      return wire(r);
    },
    changes: async (e, s) => {
      if (net.down) throw new Error('red');
      return wire(core.changes(e, s));
    },
  };
  const sync = new SyncClient(transport, 1);
  const bytes = await sync.load();
  const db = new Database(new SQL.Database(bytes), undefined, { migrate: false, remote: sync, factory: (b) => new SQL.Database(b) });
  sync.attach(db);
  return { db, sync, net };
}

const serverCount = (sql: string) => core.query<{ n: number }>(sql)[0].n;
const stockOf = (db: Database, id: string) => db.read((t) => t.get<{ q: number }>('SELECT quantity q FROM stock_levels WHERE product_id = ?', [id])!.q);

async function seed(db: Database) {
  const list = (await db.read(listPriceLists))[0].id;
  const product = await db.write((tx) => createProduct(tx, { type: 'product', name: 'Cemento', sku: 'CEM', initialStock: 10, costCents: 18000, prices: { [list]: 22000 } }));
  return { list, product };
}
const sale = (product: string, list: string, more = {}) => ({ id: crypto.randomUUID(), lines: [{ productId: product, quantity: 1, unitPriceCents: 22000, priceListId: list }], payment: { method: 'cash' as const, receivedCents: 22000 }, ...more });

describe('servidor compartido', () => {
  it('Oficina Virtual (D42): lee la venta con su forma de entrega y el retiro que registra llega a las PCs', async () => {
    const a = await pc();
    const { list, product } = await seed(a.db);
    await a.db.write((tx) => createSale(tx, sale(product, list, { deliveryMethod: 'shipping' })));
    const ventas = await core.read((tx) => tx.all<{ folio: number; delivery_method: string }>('SELECT folio, delivery_method FROM sales'));
    expect(ventas).toEqual([{ folio: 1, delivery_method: 'shipping' }]);
    const antes = core.version;
    const id = await core.writeLocal((tx) => addCashFlow(tx, { type: 'cash_out', amountCents: 50000, reason: 'gas nissan blanca (Edgar)' }).id);
    expect(core.version).toBe(antes + 1);
    expect(disk).not.toBeNull();
    await a.sync.pollOnce();
    const enPc = await a.db.read((t) => t.get<{ amount_cents: number; description: string }>('SELECT amount_cents, description FROM cash_movements WHERE id = ?', [id]));
    expect(enPc).toEqual({ amount_cents: -50000, description: 'gas nissan blanca (Edgar)' });
    // Una escritura que falla no deja nada a medias ni avisa a las PCs.
    await expect(core.writeLocal((tx) => addCashFlow(tx, { type: 'cash_out', amountCents: 0 }))).rejects.toThrow();
    expect(core.version).toBe(antes + 1);
  });

  it('lo que vende una PC aparece en la otra', async () => {
    const a = await pc();
    const b = await pc();
    const { list, product } = await seed(a.db);
    await a.db.write((tx) => createSale(tx, sale(product, list)));
    expect(serverCount('SELECT count(*) n FROM sales')).toBe(1);
    expect(await b.db.read((t) => t.get<{ n: number }>('SELECT count(*) n FROM sales')!.n)).toBe(0);
    let notified = 0;
    b.db.subscribe(() => notified++);
    await b.sync.pollOnce();
    expect(await b.db.read((t) => t.get<{ n: number }>('SELECT count(*) n FROM sales')!.n)).toBe(1);
    expect(await stockOf(b.db, product)).toBe(9);
    expect(notified).toBe(1);
  });

  it('dos PCs venden al mismo tiempo: folios distintos y el stock baja dos veces', async () => {
    const a = await pc();
    const b = await pc();
    const { list, product } = await seed(a.db);
    await b.sync.pollOnce();
    // Ninguna sabe de la otra: la segunda choca, se pone al día y recalcula.
    const [ra, rb] = await Promise.all([a.db.write((tx) => createSale(tx, sale(product, list))), b.db.write((tx) => createSale(tx, sale(product, list)))]);
    expect(new Set([ra.folio, rb.folio])).toEqual(new Set([1, 2]));
    await a.sync.pollOnce();
    await b.sync.pollOnce();
    for (const db of [a.db, b.db]) expect(await stockOf(db, product)).toBe(8);
    expect(core.query<{ q: number }>('SELECT quantity q FROM stock_levels')[0].q).toBe(8);
    expect(core.query<{ f: string }>('SELECT group_concat(folio) f FROM (SELECT folio FROM sales ORDER BY folio)')[0].f).toBe('1,2');
  });

  it('una escucha atrasada no repite lo que la propia escritura ya trajo', async () => {
    const a = await pc();
    const b = await pc();
    const { product } = await seed(a.db);
    const late = core.changes(b.sync.epoch, b.sync.version); // respuesta calculada antes
    await b.db.write((tx) => createClient(tx, { firstName: 'Beto' })); // choca, trae el producto y guarda
    expect(late.reset).toBe(false);
    expect(await b.db.read((t) => t.get<{ n: number }>('SELECT count(*) n FROM products')!.n)).toBe(1);
    // Llega la respuesta vieja: el filtro por versión evita aplicar dos veces el producto (fallaría por llave única).
    await b.db.syncJob(({ apply }) => apply(!late.reset ? late.changes.filter((c) => c.version > b.sync.version) : []));
    await b.sync.pollOnce();
    expect(await stockOf(b.db, product)).toBe(10);
    expect(await b.db.read((t) => t.get<{ n: number }>('SELECT count(*) n FROM clients')!.n)).toBe(1);
    expect(b.sync.version).toBe(core.version);
  });

  it('sin conexión no se guarda nada y se avisa; al volver, se vende normal', async () => {
    const a = await pc();
    const { list, product } = await seed(a.db);
    const statuses: string[] = [];
    a.sync.onStatus((s) => statuses.push(s));
    a.net.down = true;
    await expect(a.db.write((tx) => createSale(tx, sale(product, list)))).rejects.toBeInstanceOf(OfflineError);
    expect(await a.db.read((t) => t.get<{ n: number }>('SELECT count(*) n FROM sales')!.n)).toBe(0);
    expect(await stockOf(a.db, product)).toBe(10); // la copia local no cambió
    expect(a.sync.status).toBe('offline');
    a.net.down = false;
    await a.db.write((tx) => createSale(tx, sale(product, list)));
    expect(statuses).toEqual(['offline', 'online']);
    expect(serverCount('SELECT count(*) n FROM sales')).toBe(1);
  });

  it('si se pierde la respuesta, reintentar con el mismo id no duplica la venta', async () => {
    const a = await pc();
    const { list, product } = await seed(a.db);
    const s = sale(product, list);
    a.net.loseReply = true;
    await expect(a.db.write((tx) => createSale(tx, s))).rejects.toBeInstanceOf(OfflineError);
    expect(serverCount('SELECT count(*) n FROM sales')).toBe(1);
    const r = await a.db.write((tx) => createSale(tx, s));
    expect(r.duplicate).toBe(true);
    expect(serverCount('SELECT count(*) n FROM sales')).toBe(1);
    expect(await stockOf(a.db, product)).toBe(9);
  });

  it('cobranza y caja también se comparten', async () => {
    const a = await pc();
    const b = await pc();
    const { list, product } = await seed(a.db);
    const ana = await a.db.write((tx) => createClient(tx, { firstName: 'Ana' }));
    const s = await a.db.write((tx) => createSale(tx, sale(product, list, { clientId: ana, payment: { method: 'credit' } })));
    await b.sync.pollOnce();
    await b.db.write((tx) => createCollection(tx, { id: crypto.randomUUID(), saleId: s.id, amountCents: 22000, method: 'cash' }));
    await a.sync.pollOnce();
    expect(await a.db.read((t) => t.get<{ n: number }>("SELECT count(*) n FROM cash_movements WHERE type = 'collection'")!.n)).toBe(1);
  });

  it('el servidor rechaza sentencias que no sean INSERT, UPDATE o DELETE', async () => {
    expect(isAllowedStatement('INSERT INTO x VALUES (1)')).toBe(true);
    expect(isAllowedStatement("UPDATE x SET a = 'uno; dos'")).toBe(true);
    expect(isAllowedStatement('DROP TABLE sales')).toBe(false);
    expect(isAllowedStatement('DELETE FROM x; DROP TABLE sales')).toBe(false);
    expect(isAllowedStatement('PRAGMA foreign_keys = OFF')).toBe(false);
    await expect(core.commit(core.epoch, core.version, [{ sql: 'DROP TABLE sales' }])).rejects.toBeInstanceOf(BadRequestError);
    // Los triggers siguen protegiendo lo inmutable.
    await expect(core.commit(core.epoch, core.version, [{ sql: 'DELETE FROM cash_movements' }])).resolves.toMatchObject({ ok: true });
    const a = await pc();
    const { list, product } = await seed(a.db);
    await a.db.write((tx) => createSale(tx, sale(product, list)));
    await expect(core.commit(core.epoch, core.version, [{ sql: 'DELETE FROM cash_movements' }])).rejects.toThrow();
    expect(serverCount('SELECT count(*) n FROM cash_movements')).toBe(1);
  });

  it('guarda en disco tras cada escritura y al reabrir conserva todo', async () => {
    const a = await pc();
    const { list, product } = await seed(a.db);
    await a.db.write((tx) => createSale(tx, sale(product, list)));
    const reopened = await ServerCore.open({ SQL, bytes: disk, persist: () => undefined });
    expect(reopened.query<{ n: number }>('SELECT count(*) n FROM sales')[0].n).toBe(1);
    expect(reopened.epoch).not.toBe(core.epoch);
  });

  it('restaurar un respaldo: valida el archivo y todas las PCs recargan', async () => {
    const a = await pc();
    const b = await pc();
    const { list, product } = await seed(a.db);
    const backup = await core.backup();
    await a.db.write((tx) => createSale(tx, sale(product, list)));
    await expect(core.restore(new TextEncoder().encode('no soy una base'))).rejects.toBeInstanceOf(InvalidBackupError);
    const previous = await core.restore(backup);
    expect(new SQL.Database(previous).exec('SELECT count(*) FROM sales')[0].values[0][0]).toBe(1);
    expect(serverCount('SELECT count(*) n FROM sales')).toBe(0);
    for (const p of [a, b]) {
      await p.sync.pollOnce();
      expect(await p.db.read((t) => t.get<{ n: number }>('SELECT count(*) n FROM sales')!.n)).toBe(0);
      expect(p.sync.epoch).toBe(core.epoch);
    }
    // Y se sigue vendiendo sobre la base restaurada.
    await b.db.write((tx) => createSale(tx, sale(product, list)));
    expect(serverCount('SELECT count(*) n FROM sales')).toBe(1);
  });
});
