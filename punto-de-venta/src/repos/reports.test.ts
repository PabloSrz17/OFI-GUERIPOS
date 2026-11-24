// @vitest-environment node
import { createTestDb } from '@/db/test-db';
import type { Database } from '@/db/database';
import { periodBounds, periodBuckets, periodLabel } from '@/reports/period';
import { addCashFlow } from './cash';
import { listPriceLists } from './categories';
import { createClient } from './clients';
import { createCollection } from './collections';
import { createProduct } from './products';
import { createSale, deleteSale, type SaleInput } from './sales';
import {
  inventoryValue,
  moneyMovements,
  receivables,
  salesByClient,
  salesByClientCsv,
  salesByPaymentMethod,
  salesByPeriod,
  salesByPeriodCsv,
  salesByProduct,
  stockReport,
} from './reports';

let db: Database;
let publico: string;
let cemento: string;
let varilla: string;
let ana: string;

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const week = () => periodBounds('7d');
const sell = (over: Partial<SaleInput> & { qty?: number; product?: string; price?: number } = {}) => {
  const { qty = 1, product = cemento, price = 22000, ...rest } = over;
  return db.write((tx) => createSale(tx, { id: crypto.randomUUID(), lines: [{ productId: product, quantity: qty, unitPriceCents: price, priceListId: publico }], payment: { method: 'cash', receivedCents: 1_000_000 }, ...rest }));
};

beforeEach(async () => {
  db = await createTestDb();
  publico = (await db.read(listPriceLists))[0].id;
  [cemento, varilla, ana] = await db.write((tx) => [
    createProduct(tx, { type: 'product', name: 'Cemento', sku: 'CEM', initialStock: 10, minStock: 3, costCents: 18000, prices: { [publico]: 22000 } }),
    createProduct(tx, { type: 'product', name: 'Varilla', sku: 'VAR', initialStock: 2, minStock: 5, costCents: 10000, prices: { [publico]: 14500 } }),
    createClient(tx, { firstName: 'Ana', lastName: 'López' }),
  ]);
});

describe('periodos', () => {
  it('límites en hora local y cubetas por día y mes', () => {
    const now = new Date(2026, 10, 23, 15, 0);
    const p = periodBounds('7d', {}, now);
    expect(new Date(p.from)).toEqual(new Date(2026, 10, 17));
    expect(new Date(p.to)).toEqual(new Date(2026, 10, 24));
    expect(periodBuckets(p, 'day').map((b) => b.short)).toEqual(['17 nov', '18 nov', '19 nov', '20 nov', '21 nov', '22 nov', '23 nov']);
    expect(periodLabel(p)).toBe('17 de noviembre - 23 de noviembre');
    expect(periodBuckets(periodBounds('90d', {}, now), 'month').map((b) => b.label)).toEqual(['agosto 2026', 'septiembre 2026', 'octubre 2026', 'noviembre 2026']);
    const c = periodBounds('custom', { from: '2026-11-10', to: '2026-11-05' }, now);
    expect([new Date(c.from), new Date(c.to)]).toEqual([new Date(2026, 10, 5), new Date(2026, 10, 11)]);
    expect(new Date(periodBounds('last_month', {}, now).from)).toEqual(new Date(2026, 9, 1));
  });
});

describe('reportes de ventas', () => {
  it('ventas por periodo: conteo, total, costo y margen; sin eliminadas ni fuera del periodo', async () => {
    await sell({ qty: 2 }); // 440 / costo 360
    await sell({ product: varilla, price: 14500 }); // 145 / 100
    await sell({ createdAt: ago(3) }); // 220 / 180
    await sell({ createdAt: ago(30) }); // fuera
    const del = await sell();
    await db.write((tx) => deleteSale(tx, del.id));
    const r = await db.read((t) => salesByPeriod(t, week(), 'day'));
    expect(r.totals).toEqual({ count: 3, total: 80500, cost: 64000, margin: 16500 });
    expect(r.buckets).toHaveLength(7);
    expect(r.buckets[6]).toMatchObject({ count: 2, total: 58500 });
    expect(r.buckets[3]).toMatchObject({ count: 1, total: 22000 });
    const csv = (await db.read((t) => salesByPeriodCsv(t, week(), 'day'))).split('\n');
    expect(csv[0]).toBe('Fecha,Ventas,Ventas Totales,Costo Total,Margen');
    expect(csv[1]).toBe('Total,3,805.00,640.00,165.00');
    expect(csv[2]).toContain(',2,585.00,');
  });

  it('productos más vendidos y con más margen', async () => {
    await sell({ qty: 3 }); // cemento 660, margen 120
    await sell({ product: varilla, price: 14500, qty: 4 }); // 580, margen 180
    const byTotal = await db.read((t) => salesByProduct(t, week(), 'total'));
    expect(byTotal.map((r) => [r.name, r.quantity, r.total, r.margin])).toEqual([
      ['Cemento', 3, 66000, 12000],
      ['Varilla', 4, 58000, 18000],
    ]);
    expect((await db.read((t) => salesByProduct(t, week(), 'margin')))[0].name).toBe('Varilla');
  });

  it('por método de pago y por cliente (con su deuda)', async () => {
    await sell();
    await sell({ payment: { method: 'transfer' } });
    await sell({ clientId: ana, payment: { method: 'credit' } });
    await sell({ clientId: ana, payment: { method: 'debit_card' }, product: varilla, price: 14500 });
    const m = await db.read((t) => salesByPaymentMethod(t, week()));
    expect(m).toHaveLength(5);
    expect(m.find((x) => x.method === 'credit')).toMatchObject({ count: 1, total: 22000, label: 'A Crédito' });
    expect(m.find((x) => x.method === 'credit_card')).toMatchObject({ count: 0, total: 0 });
    const c = await db.read((t) => salesByClient(t, week()));
    expect(c.map((r) => [r.name, r.count, r.total, r.debt])).toEqual([
      ['Público en General', 2, 44000, 0],
      ['Ana López', 2, 36500, 22000],
    ]);
    expect(await db.read((t) => salesByClientCsv(t, week()))).toContain('Ana López,2,365.00,85.00,220.00');
  });
});

describe('finanzas', () => {
  it('cuentas por cobrar por antigüedad', async () => {
    const beto = await db.write((tx) => createClient(tx, { firstName: 'Beto' }));
    await sell({ clientId: ana, payment: { method: 'credit' }, createdAt: ago(20) }); // vencida
    await sell({ clientId: ana, payment: { method: 'credit' }, createdAt: ago(10) }); // vence en 5 días
    await sell({ clientId: beto, payment: { method: 'credit' } }); // vence en 15 días
    const r = await db.read((t) => receivables(t));
    expect(r.totals).toMatchObject({ clients: 2, sales: 3, total: 66000, overdue: 22000, d0_7: 22000, d8_30: 22000, d30: 0 });
    expect(r.rows.map((x) => x.name)).toEqual(['Ana López', 'Beto']);
  });

  it('movimientos de dinero: ventas, cobros, ingresos y retiros, con entradas/salidas y búsqueda', async () => {
    const s = await sell({ clientId: ana, payment: { method: 'credit' } });
    await sell({ payment: { method: 'transfer' } });
    await db.write((tx) => createCollection(tx, { id: crypto.randomUUID(), saleId: s.id, amountCents: 10000, method: 'cash' }));
    await db.write((tx) => addCashFlow(tx, { type: 'cash_in', amountCents: 50000, reason: 'Fondo' }));
    await db.write((tx) => addCashFlow(tx, { type: 'cash_out', amountCents: 3000, reason: 'Pago de luz' }));
    const all = await db.read((t) => moneyMovements(t, week()));
    expect(all.totals).toEqual({ in: 82000, out: -3000, net: 79000, count: 4 });
    expect(all.rows[0].label).toBe('Retiro de Efectivo · Pago de luz');
    expect((await db.read((t) => moneyMovements(t, week(), { q: 'retiro' }))).rows).toHaveLength(1);
    expect((await db.read((t) => moneyMovements(t, week(), { direction: 'out' }))).rows).toHaveLength(1);
    expect((await db.read((t) => moneyMovements(t, week(), { direction: 'in' }))).rows).toHaveLength(3);
    const found = await db.read((t) => moneyMovements(t, week(), { q: 'cobro de deuda' }));
    expect(found.rows.map((r) => r.sale_folio)).toEqual([1]);
    expect((await db.read((t) => moneyMovements(t, week(), { q: 'n2' }))).rows).toHaveLength(1);
  });
});

describe('inventario', () => {
  it('stock con estado (bajo, sin stock) y búsqueda', async () => {
    await sell({ product: varilla, price: 14500, qty: 3 }); // varilla queda en -1
    const r = await db.read((t) => stockReport(t));
    expect(r.counts).toEqual({ all: 2, ok: 1, low: 0, out: 1 });
    expect((await db.read((t) => stockReport(t, { status: 'out' }))).rows.map((x) => x.name)).toEqual(['Varilla']);
    await sell({ qty: 7 }); // cemento 3 = mínimo
    expect((await db.read((t) => stockReport(t, { status: 'low' }))).rows.map((x) => x.name)).toEqual(['Cemento']);
    expect((await db.read((t) => stockReport(t, { q: 'cem' }))).rows).toHaveLength(1);
  });

  it('valor del inventario: solo stock positivo, a precio y a costo', async () => {
    await sell({ product: varilla, price: 14500, qty: 3 });
    const r = await db.read((t) => inventoryValue(t));
    expect(r.totals).toEqual({ products: 2, units: 10, value: 220000, cost: 180000, margin: 40000, negative: 1 });
    expect(r.rows).toEqual([{ category: 'Sin categoría', products: 2, units: 10, value: 220000, cost: 180000, margin: 40000 }]);
  });
});
