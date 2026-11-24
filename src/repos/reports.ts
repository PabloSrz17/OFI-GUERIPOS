import type { Tx } from '@/db/database';
import { PAYMENT_METHODS, saleFolio, type PaymentMethod } from '@/domain/sale';
import { bucketKey, periodBuckets, type Granularity, type Period } from '@/reports/period';
import { daysUntil } from './collections';
import { clientName } from './clients';
import { balanceSql } from './common';
import type { CashMethod } from '@/domain/sale';

/**
 * Reportes (reference/pulpos/reports.md). Solo lectura. Las ventas eliminadas no cuentan (su dinero ya se regresó);
 * los pedidos sí, porque se cobran igual que una venta (D14). Costo = costo del producto al vender × cantidad.
 */

const saleInPeriod = `s.deleted_at IS NULL AND s.created_at >= :from AND s.created_at < :to`;
const pp = (p: Period) => ({ ':from': p.from, ':to': p.to });

// ---------- CSV ----------

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const pesos = (c: number) => (c / 100).toFixed(2);
export function toCsv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

// ---------- Ventas por periodo ----------

export interface SalesTotals {
  count: number;
  total: number;
  cost: number;
  margin: number;
}
export interface SalesBucket extends SalesTotals {
  key: string;
  label: string;
  short: string;
}

const emptyTotals = (): SalesTotals => ({ count: 0, total: 0, cost: 0, margin: 0 });

function periodSales(tx: Tx, p: Period) {
  return tx.all<{ id: string; created_at: string; total_cents: number; cost_cents: number }>(
    `SELECT s.id, s.created_at, s.total_cents,
       (SELECT coalesce(sum(round(i.cost_cents * i.quantity)), 0) FROM sale_items i WHERE i.sale_id = s.id) cost_cents
     FROM sales s WHERE ${saleInPeriod}`,
    pp(p),
  );
}

/** "Reporte de Ventas" (I-report-sales-by-period.png): Total y una fila por día o mes, más reciente primero. */
export function salesByPeriod(tx: Tx, p: Period, g: Granularity) {
  const buckets = new Map<string, SalesBucket>(periodBuckets(p, g).map((b) => [b.key, { ...b, ...emptyTotals() }]));
  const totals = emptyTotals();
  for (const s of periodSales(tx, p)) {
    const b = buckets.get(bucketKey(s.created_at, g));
    for (const t of b ? [b, totals] : [totals]) {
      t.count += 1;
      t.total += s.total_cents;
      t.cost += s.cost_cents;
      t.margin += s.total_cents - s.cost_cents;
    }
  }
  return { totals, buckets: [...buckets.values()] };
}

export function salesByPeriodCsv(tx: Tx, p: Period, g: Granularity) {
  const r = salesByPeriod(tx, p, g);
  const row = (label: string, t: SalesTotals) => [label, t.count, pesos(t.total), pesos(t.cost), pesos(t.margin)];
  return toCsv(['Fecha', 'Ventas', 'Ventas Totales', 'Costo Total', 'Margen'], [row('Total', r.totals), ...[...r.buckets].reverse().map((b) => row(b.label, b))]);
}

// ---------- Productos ----------

export type ProductOrder = 'total' | 'margin' | 'quantity';
export interface ProductSalesRow {
  key: string;
  product_id: string | null;
  name: string;
  sku: string | null;
  quantity: number;
  total: number;
  cost: number;
  margin: number;
  sales: number;
}

/** "Productos más Vendidos" y "Productos con más Margen". */
export function salesByProduct(tx: Tx, p: Period, order: ProductOrder = 'total') {
  const col = { total: 'total', margin: 'margin', quantity: 'quantity' }[order];
  return tx.all<ProductSalesRow>(
    `SELECT coalesce(i.product_id, 'name:' || i.name) key, i.product_id, coalesce(pr.name, i.name) name, coalesce(pr.sku, i.sku) sku,
       sum(i.quantity) quantity, sum(i.total_cents) total, sum(round(i.cost_cents * i.quantity)) cost,
       sum(i.total_cents) - sum(round(i.cost_cents * i.quantity)) margin, count(DISTINCT s.id) sales
     FROM sale_items i JOIN sales s ON s.id = i.sale_id LEFT JOIN products pr ON pr.id = i.product_id
     WHERE ${saleInPeriod}
     GROUP BY key ORDER BY ${col} DESC, name`,
    pp(p),
  );
}

export function salesByProductCsv(tx: Tx, p: Period, order: ProductOrder) {
  return toCsv(
    ['Producto', 'SKU', 'Cantidad', 'Ventas', 'Facturación', 'Costo', 'Margen'],
    salesByProduct(tx, p, order).map((r) => [r.name, r.sku, r.quantity, r.sales, pesos(r.total), pesos(r.cost), pesos(r.margin)]),
  );
}

// ---------- Método de pago ----------

export interface MethodRow {
  method: PaymentMethod;
  label: string;
  count: number;
  total: number;
}

/** "Ventas por Método de Pago" (I-report-payment-methods.png). Un solo método por venta (D12). */
export function salesByPaymentMethod(tx: Tx, p: Period) {
  const rows = tx.all<{ method: PaymentMethod; count: number; total: number }>(
    `SELECT s.payment_method method, count(*) count, sum(s.total_cents) total FROM sales s WHERE ${saleInPeriod} GROUP BY s.payment_method`,
    pp(p),
  );
  const out: MethodRow[] = PAYMENT_METHODS.map((m) => {
    const r = rows.find((x) => x.method === m.value);
    return { method: m.value, label: m.label, count: r?.count ?? 0, total: r?.total ?? 0 };
  });
  return out.sort((a, b) => b.total - a.total);
}

export function salesByPaymentMethodCsv(tx: Tx, p: Period) {
  return toCsv(['Método de Pago', 'Ventas', 'Total'], salesByPaymentMethod(tx, p).map((r) => [r.label, r.count, pesos(r.total)]));
}

// ---------- Cliente ----------

export interface ClientSalesRow {
  client_id: string | null;
  name: string;
  count: number;
  total: number;
  margin: number;
  /** Deuda pendiente del cliente hoy (de todas sus ventas). */
  debt: number;
}

export const NO_CLIENT = 'Público en General';

/** "Ventas por Cliente". Las ventas sin cliente se agrupan en "Público en General". */
export function salesByClient(tx: Tx, p: Period) {
  const rows = tx.all<{ client_id: string | null; first_name: string | null; last_name: string | null; count: number; total: number; cost: number; debt: number }>(
    `SELECT s.client_id, c.first_name, c.last_name, count(*) count, sum(s.total_cents) total,
       sum((SELECT coalesce(sum(round(i.cost_cents * i.quantity)), 0) FROM sale_items i WHERE i.sale_id = s.id)) cost,
       CASE WHEN s.client_id IS NULL THEN 0 ELSE (SELECT coalesce(sum(${balanceSql('x')}), 0) FROM sales x WHERE x.client_id = s.client_id AND x.deleted_at IS NULL) END debt
     FROM sales s LEFT JOIN clients c ON c.id = s.client_id
     WHERE ${saleInPeriod} GROUP BY s.client_id ORDER BY total DESC`,
    pp(p),
  );
  return rows.map<ClientSalesRow>((r) => ({
    client_id: r.client_id,
    name: r.client_id ? clientName({ first_name: r.first_name ?? '', last_name: r.last_name }) : NO_CLIENT,
    count: r.count,
    total: r.total,
    margin: r.total - r.cost,
    debt: r.debt,
  }));
}

export function salesByClientCsv(tx: Tx, p: Period) {
  return toCsv(['Cliente', 'Ventas', 'Total', 'Margen', 'Deuda Pendiente'], salesByClient(tx, p).map((r) => [r.name, r.count, pesos(r.total), pesos(r.margin), pesos(r.debt)]));
}

// ---------- Cuentas por cobrar ----------

export interface ReceivableRow {
  client_id: string;
  name: string;
  sales: number;
  total: number;
  overdue: number;
  d0_7: number;
  d8_30: number;
  d30: number;
  /** Vencimiento más antiguo (para ordenar y mostrar). */
  oldest_due: string | null;
}

/** "Cuentas por Cobrar" (diseño propio, D28): deuda de hoy por cliente según cuándo vence. No depende del periodo. */
export function receivables(tx: Tx, now = new Date()) {
  const rows = tx.all<{ client_id: string; first_name: string; last_name: string | null; balance: number; due_date: string | null }>(
    `SELECT s.client_id, c.first_name, c.last_name, ${balanceSql('s')} balance, s.due_date FROM sales s JOIN clients c ON c.id = s.client_id
     WHERE s.deleted_at IS NULL AND ${balanceSql('s')} > 0 ORDER BY coalesce(s.due_date, s.created_at)`,
  );
  const map = new Map<string, ReceivableRow>();
  const totals = { clients: 0, sales: 0, total: 0, overdue: 0, d0_7: 0, d8_30: 0, d30: 0 };
  for (const r of rows) {
    let row = map.get(r.client_id);
    if (!row) {
      row = { client_id: r.client_id, name: clientName(r), sales: 0, total: 0, overdue: 0, d0_7: 0, d8_30: 0, d30: 0, oldest_due: r.due_date };
      map.set(r.client_id, row);
    }
    const d = r.due_date ? daysUntil(r.due_date, now) : 0;
    const bucket = d < 0 ? 'overdue' : d <= 7 ? 'd0_7' : d <= 30 ? 'd8_30' : 'd30';
    row.sales += 1;
    row.total += r.balance;
    row[bucket] += r.balance;
    totals.sales += 1;
    totals.total += r.balance;
    totals[bucket] += r.balance;
  }
  const list = [...map.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total);
  totals.clients = list.length;
  return { totals, rows: list };
}

export function receivablesCsv(tx: Tx) {
  return toCsv(
    ['Cliente', 'Ventas con Deuda', 'Deuda Total', 'Vencida', 'A cobrar en 0 a 7 días', 'A cobrar en 8 a 30 días', 'A cobrar en +30 días'],
    receivables(tx).rows.map((r) => [r.name, r.sales, pesos(r.total), pesos(r.overdue), pesos(r.d0_7), pesos(r.d8_30), pesos(r.d30)]),
  );
}

// ---------- Movimientos de dinero ----------

export type MoneyDirection = 'all' | 'in' | 'out';
export interface MoneyMovementRow {
  id: string;
  type: string;
  method: CashMethod;
  amount_cents: number;
  description: string;
  register_name: string;
  user_name: string;
  created_at: string;
  sale_id: string | null;
  sale_folio: number | null;
  /** "Retiro de Efectivo · Pago de luz": el tipo del movimiento y su motivo (o la descripción guardada). */
  label: string;
}

const FLOW_LABEL: Record<string, string> = { cash_in: 'Ingreso de Efectivo', cash_out: 'Retiro de Efectivo' };
function movementLabel(type: string, description: string) {
  const base = FLOW_LABEL[type];
  return base && description !== base ? `${base} · ${description}` : description;
}

/** "Movimientos de Dinero" (I-report-money-movements.png): el libro de caja con ventas, cobros, ingresos, retiros y anulaciones. */
export function moneyMovements(tx: Tx, p: Period, opts: { direction?: MoneyDirection; q?: string } = {}) {
  const where = ['m.created_at >= :from', 'm.created_at < :to'];
  const params: Record<string, string> = pp(p);
  if (opts.direction === 'in') where.push('m.amount_cents > 0');
  if (opts.direction === 'out') where.push('m.amount_cents < 0');
  const q = opts.q?.trim().toLowerCase();
  if (q) {
    where.push(`(lower(m.description) LIKE :q OR (m.type = 'cash_in' AND 'ingreso de efectivo' LIKE :q) OR (m.type = 'cash_out' AND 'retiro de efectivo' LIKE :q) OR lower(m.user_name) LIKE :q OR ('n' || s.folio) LIKE :qf)`);
    params[':q'] = `%${q}%`;
    params[':qf'] = `%${q.replace(/^#/, '')}%`;
  }
  const rows = tx.all<Omit<MoneyMovementRow, 'label'>>(
    `SELECT m.id, m.type, m.method, m.amount_cents, m.description, r.name register_name, m.user_name, m.created_at, s.id sale_id, s.folio sale_folio
     FROM cash_movements m JOIN cash_registers r ON r.id = m.register_id
     LEFT JOIN payments pa ON m.ref_type = 'payment' AND pa.id = m.ref_id LEFT JOIN sales s ON s.id = pa.sale_id
     WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC, m.rowid DESC`,
    params,
  ).map<MoneyMovementRow>((r) => ({ ...r, label: movementLabel(r.type, r.description) }));
  const totals = { in: 0, out: 0, net: 0, count: rows.length };
  for (const r of rows) {
    if (r.amount_cents > 0) totals.in += r.amount_cents;
    else totals.out += r.amount_cents;
    totals.net += r.amount_cents;
  }
  return { rows, totals };
}

export function moneyMovementsCsv(tx: Tx, p: Period, opts: { direction?: MoneyDirection; q?: string } = {}) {
  return toCsv(
    ['Fecha', 'Movimiento', 'Venta', 'Método de Pago', 'Tipo', 'Monto', 'Caja', 'Usuario'],
    moneyMovements(tx, p, opts).rows.map((r) => [
      r.created_at,
      r.label,
      r.sale_folio ? saleFolio(r.sale_folio) : '',
      PAYMENT_METHODS.find((m) => m.value === r.method)?.label ?? r.method,
      r.amount_cents >= 0 ? 'Entrada' : 'Salida',
      pesos(r.amount_cents),
      r.register_name,
      r.user_name,
    ]),
  );
}

// ---------- Inventario ----------

export type StockStatus = 'ok' | 'low' | 'out';
export interface StockRow {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  unit: string;
  stock: number;
  min_stock: number;
  cost_cents: number;
  price_cents: number;
  status: StockStatus;
}

/** Precio de la primera lista ("Público"): es el que se usa para valuar el inventario. */
function stockRows(tx: Tx) {
  const list = tx.get<{ id: string }>('SELECT id FROM price_lists WHERE deleted_at IS NULL ORDER BY position LIMIT 1')?.id ?? '';
  return tx
    .all<Omit<StockRow, 'status'>>(
      `SELECT p.id, p.name, p.sku, coalesce(c.name, 'Sin categoría') category, p.unit,
         coalesce((SELECT sum(quantity) FROM stock_levels WHERE product_id = p.id), 0) stock,
         coalesce((SELECT sum(min_quantity) FROM stock_levels WHERE product_id = p.id), 0) min_stock,
         p.cost_cents, coalesce((SELECT price_cents FROM product_prices WHERE product_id = p.id AND price_list_id = :list), 0) price_cents
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.deleted_at IS NULL AND p.type = 'product' AND p.track_stock = 1 ORDER BY p.name COLLATE NOCASE`,
      { ':list': list },
    )
    .map<StockRow>((r) => ({ ...r, status: r.stock <= 0 ? 'out' : r.min_stock > 0 && r.stock <= r.min_stock ? 'low' : 'ok' }));
}

/** "Stock de Productos": existencias, mínimo y estado. */
export function stockReport(tx: Tx, opts: { q?: string; status?: StockStatus | 'all' } = {}) {
  const all = stockRows(tx);
  const counts = { all: all.length, ok: 0, low: 0, out: 0 };
  for (const r of all) counts[r.status] += 1;
  const q = opts.q?.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const rows = all.filter(
    (r) =>
      (!opts.status || opts.status === 'all' || r.status === opts.status) &&
      (!q || `${r.name} ${r.sku ?? ''} ${r.category}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q)),
  );
  return { rows, counts };
}

const STATUS_LABEL: Record<StockStatus, string> = { ok: 'Con stock', low: 'Bajo stock', out: 'Sin stock' };
export const stockStatusLabel = (s: StockStatus) => STATUS_LABEL[s];

export function stockCsv(tx: Tx, opts: { q?: string; status?: StockStatus | 'all' } = {}) {
  return toCsv(
    ['Producto', 'SKU', 'Categoría', 'Stock', 'Stock Mínimo', 'Estado', 'Costo', 'Precio'],
    stockReport(tx, opts).rows.map((r) => [r.name, r.sku, r.category, r.stock, r.min_stock, STATUS_LABEL[r.status], pesos(r.cost_cents), pesos(r.price_cents)]),
  );
}

export interface InventoryValueRow {
  category: string;
  products: number;
  units: number;
  value: number;
  cost: number;
  margin: number;
}

/**
 * "Valor del Inventario": Valor = Σ stock × precio, Costo = Σ stock × costo, Margen = Valor − Costo, por categoría.
 * Solo cuenta el stock positivo (D29): el negativo es mercancía vendida que falta capturar, no inventario.
 */
export function inventoryValue(tx: Tx) {
  const byCat = new Map<string, InventoryValueRow>();
  const totals = { products: 0, units: 0, value: 0, cost: 0, margin: 0, negative: 0 };
  for (const r of stockRows(tx)) {
    const row = byCat.get(r.category) ?? { category: r.category, products: 0, units: 0, value: 0, cost: 0, margin: 0 };
    byCat.set(r.category, row);
    row.products += 1;
    totals.products += 1;
    if (r.stock < 0) totals.negative += 1;
    const units = Math.max(0, r.stock);
    const value = Math.round(units * r.price_cents);
    const cost = Math.round(units * r.cost_cents);
    for (const t of [row, totals]) {
      t.units += units;
      t.value += value;
      t.cost += cost;
      t.margin += value - cost;
    }
  }
  return { totals, rows: [...byCat.values()].sort((a, b) => b.value - a.value) };
}

export function inventoryValueCsv(tx: Tx) {
  const r = inventoryValue(tx);
  return toCsv(
    ['Categoría', 'Productos', 'Unidades', 'Valor', 'Costo', 'Margen'],
    [['Total', r.totals.products, r.totals.units, pesos(r.totals.value), pesos(r.totals.cost), pesos(r.totals.margin)], ...r.rows.map((x) => [x.category, x.products, x.units, pesos(x.value), pesos(x.cost), pesos(x.margin)])],
  );
}
