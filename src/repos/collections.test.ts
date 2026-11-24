// @vitest-environment node
import { createTestDb } from '@/db/test-db';
import type { Database } from '@/db/database';
import { listPriceLists } from './categories';
import { createCut, currentCash } from './cash';
import { clientName, createClient, listClients } from './clients';
import { cancelCollection, clientCollections, clientDebtSummary, createCollection, daysUntil, getCollection, planCollection } from './collections';
import { createProduct } from './products';
import { createSale, deleteSale, getSale } from './sales';

let db: Database;
let ana: string;
let cemento: string;
let publico: string;

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
/** Venta a crédito de $220 × qty; el plazo predeterminado es de 15 días. */
const credit = (qty = 1, createdAt?: string) =>
  db.write((tx) => createSale(tx, { id: crypto.randomUUID(), clientId: ana, lines: [{ productId: cemento, quantity: qty, unitPriceCents: 22000, priceListId: publico }], payment: { method: 'credit' }, createdAt }));
const balance = (id: string) => db.read((t) => getSale(t, id)!.balance_cents);
const cashTotal = (method = 'cash') => db.read((t) => currentCash(t).breakdown.find((b) => b.method === method)!.expected);

beforeEach(async () => {
  db = await createTestDb();
  publico = (await db.read(listPriceLists))[0].id;
  [ana, cemento] = await db.write((tx) => [
    createClient(tx, { firstName: 'Ana', lastName: 'López' }),
    createProduct(tx, { type: 'product', name: 'Cemento', sku: 'CEM', initialStock: 50, prices: { [publico]: 22000 } }),
  ]);
});

describe('cobranza', () => {
  it('detalle de deuda: vencida, 0 a 7 días y más de 7 días', async () => {
    await credit(1, ago(20)); // vence hace 5 días
    await credit(2, ago(10)); // vence en 5 días
    await credit(3); // vence en 15 días
    const d = await db.read((t) => clientDebtSummary(t, ana));
    expect(d).toMatchObject({ total: 132000, overdue: 22000, within7: 44000, later: 66000 });
    expect(d.sales.map((s) => s.balance_cents)).toEqual([22000, 44000, 66000]);
    expect(daysUntil('2026-11-30T10:00:00Z', new Date('2026-11-23T23:00:00Z'))).toBe(7);
  });

  it('desde el cliente reparte de la deuda más antigua a la más nueva, con abonos parciales', async () => {
    const a = (await credit(1, ago(20))).id;
    const b = (await credit(2, ago(10))).id;
    const plan = await db.read((t) => planCollection(t, { clientId: ana }, 30000));
    expect(plan.map((p) => [p.applied, p.balanceAfter])).toEqual([[22000, 0], [8000, 36000]]);

    const id = crypto.randomUUID();
    const r = await db.write((tx) => createCollection(tx, { id, clientId: ana, amountCents: 30000, method: 'cash', receivedCents: 50000 }));
    expect(r).toMatchObject({ folio: 1, changeCents: 20000, duplicate: false });
    expect(await balance(a)).toBe(0);
    expect(await balance(b)).toBe(36000);
    expect(await cashTotal()).toBe(30000);
    // Doble clic: el mismo id no cobra dos veces.
    expect(await db.write((tx) => createCollection(tx, { id, clientId: ana, amountCents: 30000, method: 'cash' }))).toMatchObject({ duplicate: true });
    expect(await cashTotal()).toBe(30000);

    const c = (await db.read((t) => getCollection(t, id)))!;
    expect(c).toMatchObject({ client_name: 'Ana López', amount_cents: 30000, remaining_debt_cents: 36000 });
    expect(c.sales.map((s) => [s.amount_cents, s.balance_cents])).toEqual([[22000, 0], [8000, 36000]]);
    const events = await db.read((t) => getSale(t, a)!.events.map((e) => e.title));
    expect(events).toContain('Cobro de $220.00 en Efectivo');
    expect(await db.read((t) => t.get<{ n: number }>("SELECT count(*) n FROM outbox WHERE entity = 'collection'")!.n)).toBe(1);
  });

  it('desde una venta solo cobra esa venta', async () => {
    await credit(1, ago(20));
    const b = (await credit(2)).id;
    await db.write((tx) => createCollection(tx, { id: crypto.randomUUID(), saleId: b, amountCents: 10000, method: 'transfer' }));
    expect(await balance(b)).toBe(34000);
    expect((await db.read((t) => clientDebtSummary(t, ana))).overdue).toBe(22000);
    expect(await cashTotal('transfer')).toBe(10000);
    await expect(db.write((tx) => createCollection(tx, { id: crypto.randomUUID(), saleId: b, amountCents: 34001, method: 'cash' }))).rejects.toThrow('mayor que la deuda');
  });

  it('valida monto, efectivo recibido y que haya deuda', async () => {
    const v = (amountCents: number, more = {}) => db.write((tx) => createCollection(tx, { id: crypto.randomUUID(), clientId: ana, amountCents, method: 'cash', ...more }));
    await expect(v(1000)).rejects.toThrow('No hay deuda');
    await credit();
    await expect(v(0)).rejects.toThrow('mayor a $0');
    await expect(v(22001)).rejects.toThrow('mayor que la deuda ($220.00)');
    await expect(v(22000, { receivedCents: 20000 })).rejects.toThrow('no alcanza');
    expect(await db.read((t) => t.get<{ n: number }>('SELECT count(*) n FROM collections')!.n)).toBe(0);
  });

  it('cancelar regresa la deuda y saca el dinero de la caja sin borrar nada', async () => {
    const a = (await credit()).id;
    const id = crypto.randomUUID();
    await db.write((tx) => createCollection(tx, { id, clientId: ana, amountCents: 22000, method: 'cash' }));
    expect(await db.write((tx) => cancelCollection(tx, id))).toBe(true);
    expect(await db.write((tx) => cancelCollection(tx, id))).toBe(false);
    expect(await balance(a)).toBe(22000);
    expect(await cashTotal()).toBe(0);
    expect(await db.read((t) => t.all<{ type: string }>('SELECT type FROM cash_movements ORDER BY rowid').map((m) => m.type))).toEqual(['collection', 'collection_void']);
    const [last] = await db.read((t) => clientCollections(t, ana));
    expect(last.canceled_at).not.toBeNull();
  });

  it('no se cancela después del corte ni si la venta se eliminó', async () => {
    const a = (await credit()).id;
    const id = crypto.randomUUID();
    await db.write((tx) => createCollection(tx, { id, clientId: ana, amountCents: 10000, method: 'cash' }));
    await db.write((tx) => createCut(tx, { id: crypto.randomUUID(), counted: { cash: 10000 }, comments: '' }));
    expect((await db.read((t) => clientCollections(t, ana)))[0].in_cut).toBe(true);
    await expect(db.write((tx) => cancelCollection(tx, id))).rejects.toThrow('corte de caja');

    const id2 = crypto.randomUUID();
    await db.write((tx) => createCollection(tx, { id: id2, clientId: ana, amountCents: 5000, method: 'cash' }));
    await db.write((tx) => deleteSale(tx, a));
    await expect(db.write((tx) => cancelCollection(tx, id2))).rejects.toThrow('fue eliminada');
  });

  it('filtro Estado de Deuda en la lista de clientes', async () => {
    const [beto, caro] = await db.write((tx) => [createClient(tx, { firstName: 'Beto' }), createClient(tx, { firstName: 'Caro' })]);
    await credit(1, ago(20)); // Ana: vencida
    await db.write((tx) => createSale(tx, { id: crypto.randomUUID(), clientId: beto, lines: [{ productId: cemento, quantity: 1, unitPriceCents: 22000, priceListId: publico }], payment: { method: 'credit' } }));
    const names = (debt: 'none' | 'overdue' | 'current') => db.read((t) => listClients(t, { debt }).rows.map(clientName));
    expect(await names('overdue')).toEqual(['Ana López']);
    expect(await names('current')).toEqual(['Beto']);
    expect(await names('none')).toEqual(['Caro']);
    void caro;
  });
});
