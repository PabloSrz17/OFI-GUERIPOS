import type { Tx } from '@/db/database';
import { paymentMethodLabel, saleFolio, type CashMethod } from '@/domain/sale';
import { formatMoney } from '@/lib/format';
import { defaultRegisterId } from './bootstrap';
import { clientName } from './clients';
import { CURRENT_USER, ValidationError, balanceSql, enqueueOutbox, newId, nowIso, rowOf } from './common';
import { registerName } from './cash';
import { addEvent, recordPayment } from './sales';

/**
 * Cobranza (reference/pulpos/clients.md): deuda por cliente, Registrar Cobro, Últimos Cobros y Estado de Cuenta.
 * Un cobro agrupa los pagos que reparte entre las ventas con deuda (D23); cada pago entra a la caja como
 * "Cobro de Deuda en Venta N#".
 */

const money = (c: number) => formatMoney(c / 100);

export interface DebtSale {
  id: string;
  folio: number;
  total_cents: number;
  balance_cents: number;
  due_date: string | null;
  created_at: string;
}

/** Días de calendario entre hoy y el vencimiento (negativo = vencida). */
export function daysUntil(dueIso: string, now = new Date()) {
  const due = new Date(dueIso);
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((day(due) - day(now)) / 86_400_000);
}

/** Ventas con saldo del cliente, en el orden en que se cobran: la que vence primero (y la más antigua) primero. */
export function clientDebtSales(tx: Tx, clientId: string) {
  return tx.all<DebtSale>(
    `SELECT s.id, s.folio, s.total_cents, ${balanceSql('s')} balance_cents, s.due_date, s.created_at FROM sales s
     WHERE s.client_id = ? AND s.deleted_at IS NULL AND ${balanceSql('s')} > 0
     ORDER BY coalesce(s.due_date, s.created_at), s.created_at, s.folio`,
    [clientId],
  );
}

/** "Detalle de Deuda" (J-client-detail.png): Vencida · A cobrar en 0 a 7 días · A cobrar en +7 días. */
export function clientDebtSummary(tx: Tx, clientId: string, now = new Date()) {
  const sales = clientDebtSales(tx, clientId);
  const out = { total: 0, overdue: 0, within7: 0, later: 0, sales };
  for (const s of sales) {
    out.total += s.balance_cents;
    const d = s.due_date ? daysUntil(s.due_date, now) : 0;
    if (d < 0) out.overdue += s.balance_cents;
    else if (d <= 7) out.within7 += s.balance_cents;
    else out.later += s.balance_cents;
  }
  return out;
}

export interface Allocation {
  saleId: string;
  folio: number;
  balanceBefore: number;
  applied: number;
  balanceAfter: number;
}

/** Cómo se reparte un monto: desde el cliente, de la venta que vence primero a la última; desde una venta, solo a ella. */
export function planCollection(tx: Tx, target: { clientId?: string | null; saleId?: string | null }, amountCents: number): Allocation[] {
  const sales = target.saleId
    ? tx.all<DebtSale>(`SELECT s.id, s.folio, s.total_cents, ${balanceSql('s')} balance_cents, s.due_date, s.created_at FROM sales s WHERE s.id = ? AND s.deleted_at IS NULL`, [target.saleId])
    : target.clientId
      ? clientDebtSales(tx, target.clientId)
      : [];
  let left = Math.max(0, Math.round(amountCents));
  const out: Allocation[] = [];
  for (const s of sales) {
    if (s.balance_cents <= 0) continue;
    const applied = Math.min(left, s.balance_cents);
    out.push({ saleId: s.id, folio: s.folio, balanceBefore: s.balance_cents, applied, balanceAfter: s.balance_cents - applied });
    left -= applied;
  }
  return out;
}

export interface CollectionInput {
  /** Id generado al abrir "Registrar Cobro": el cobro es idempotente. */
  id: string;
  clientId?: string | null;
  saleId?: string | null;
  amountCents: number;
  method: CashMethod;
  /** Solo en efectivo: lo que entregó el cliente (para el cambio). */
  receivedCents?: number | null;
}

/**
 * Registrar Cobro (diseño propio, D23). En una transacción: el cobro, un pago por venta (cada uno con su
 * movimiento de caja y su evento en el historial de la venta) y el outbox. Admite abonos parciales; no admite
 * cobrar más de lo que se debe.
 */
export function createCollection(tx: Tx, input: CollectionInput) {
  const dup = tx.get<{ id: string; folio: number; change_cents: number }>('SELECT id, folio, change_cents FROM collections WHERE id = ?', [input.id]);
  if (dup) return { id: dup.id, folio: dup.folio, changeCents: dup.change_cents, duplicate: true };

  let clientId = input.clientId ?? null;
  if (input.saleId) {
    const s = tx.get<{ client_id: string | null; deleted_at: string | null }>('SELECT client_id, deleted_at FROM sales WHERE id = ?', [input.saleId]);
    if (!s || s.deleted_at) throw new ValidationError('La venta no existe o fue eliminada');
    clientId = s.client_id;
  } else if (!clientId) throw new ValidationError('Elige un cliente o una venta');

  const amount = Math.round(input.amountCents);
  if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError('Ingresa un monto mayor a $0', 'amount');
  const plan = planCollection(tx, { clientId, saleId: input.saleId }, amount);
  const debt = plan.reduce((a, p) => a + p.balanceBefore, 0);
  if (debt === 0) throw new ValidationError('No hay deuda pendiente');
  if (amount > debt) throw new ValidationError(`El monto es mayor que la deuda (${money(debt)})`, 'amount');

  let received: number | null = null;
  let change = 0;
  if (input.method === 'cash') {
    received = Math.round(input.receivedCents ?? amount);
    if (!Number.isFinite(received) || received < amount) throw new ValidationError('El efectivo recibido no alcanza', 'received');
    change = received - amount;
  }

  const registerId = defaultRegisterId(tx);
  const folio = (tx.get<{ n: number | null }>('SELECT max(folio) n FROM collections')!.n ?? 0) + 1;
  const at = nowIso();
  tx.run(
    `INSERT INTO collections (id, folio, client_id, register_id, method, amount_cents, received_cents, change_cents, user_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.id, folio, clientId, registerId, input.method, amount, received, change, CURRENT_USER, at],
  );
  const inRegister = `${CURRENT_USER} en ${registerName(tx, registerId)}`;
  for (const p of plan) {
    if (p.applied <= 0) continue;
    const pid = recordPayment(tx, { saleId: p.saleId, clientId, registerId, kind: 'collection', method: input.method, amountCents: p.applied, description: `Cobro de Deuda en Venta ${saleFolio(p.folio)}`, at });
    tx.run('UPDATE payments SET collection_id = ? WHERE id = ?', [input.id, pid]);
    addEvent(tx, p.saleId, 'collection', `Cobro de ${money(p.applied)} en ${paymentMethodLabel(input.method)}`, inRegister, at);
  }
  enqueueOutbox(tx, 'collection', input.id, 'upsert', { collection: rowOf(tx, 'collections', input.id), payments: tx.all('SELECT * FROM payments WHERE collection_id = ?', [input.id]) });
  return { id: input.id, folio, changeCents: change, duplicate: false };
}

/**
 * Cancelar Cobro (D24): con confirmación y solo antes del corte. La deuda vuelve (los pagos se revierten) y el
 * dinero sale de la caja con movimientos 'collection_void'. No se borra nada.
 */
export function cancelCollection(tx: Tx, id: string) {
  const c = tx.get<{ id: string; folio: number; canceled_at: string | null }>('SELECT id, folio, canceled_at FROM collections WHERE id = ?', [id]);
  if (!c) throw new ValidationError('El cobro no existe');
  if (c.canceled_at) return false;
  const pays = tx.all<{ id: string; sale_id: string; amount_cents: number; method: CashMethod; reversed_at: string | null }>('SELECT id, sale_id, amount_cents, method, reversed_at FROM payments WHERE collection_id = ?', [id]);
  if (pays.some((p) => p.reversed_at)) throw new ValidationError('Una de las ventas de este cobro fue eliminada; el cobro ya no se puede cancelar');
  const movs = tx.all<{ id: string; register_id: string; method: CashMethod; amount_cents: number; description: string; cut_id: string | null; ref_id: string }>(
    `SELECT id, register_id, method, amount_cents, description, cut_id, ref_id FROM cash_movements WHERE ref_type = 'payment' AND ref_id IN (SELECT id FROM payments WHERE collection_id = ?)`,
    [id],
  );
  if (movs.some((m) => m.cut_id)) throw new ValidationError('Este cobro ya está en un corte de caja; no se puede cancelar');
  const at = nowIso();
  tx.run('UPDATE collections SET canceled_at = ? WHERE id = ?', [at, id]);
  for (const p of pays) {
    tx.run('UPDATE payments SET reversed_at = ? WHERE id = ?', [at, p.id]);
    enqueueOutbox(tx, 'payment', p.id, 'upsert', rowOf(tx, 'payments', p.id));
    addEvent(tx, p.sale_id, 'collection_canceled', `Cobro de ${money(p.amount_cents)} cancelado`, CURRENT_USER, at);
  }
  for (const m of movs) {
    const vid = newId();
    tx.run(
      `INSERT INTO cash_movements (id, register_id, type, method, amount_cents, description, ref_type, ref_id, voids_id, user_name, created_at) VALUES (?, ?, 'collection_void', ?, ?, ?, 'payment', ?, ?, ?, ?)`,
      [vid, m.register_id, m.method, -m.amount_cents, `Cancelación de ${m.description}`, m.ref_id, m.id, CURRENT_USER, at],
    );
    enqueueOutbox(tx, 'cash_movement', vid, 'upsert', rowOf(tx, 'cash_movements', vid));
  }
  enqueueOutbox(tx, 'collection', id, 'upsert', { collection: rowOf(tx, 'collections', id) });
  return true;
}

export interface CollectionRow {
  id: string;
  folio: number;
  client_id: string | null;
  method: CashMethod;
  amount_cents: number;
  received_cents: number | null;
  change_cents: number;
  user_name: string;
  created_at: string;
  canceled_at: string | null;
  /** Ventas cobradas, con lo aplicado a cada una. */
  sales: { id: string; folio: number; amount_cents: number }[];
  /** true si algún pago ya está en un corte (entonces no se puede cancelar). */
  in_cut: boolean;
}

function withSales(tx: Tx, rows: Omit<CollectionRow, 'sales' | 'in_cut'>[]): CollectionRow[] {
  return rows.map((r) => ({
    ...r,
    sales: tx.all<{ id: string; folio: number; amount_cents: number }>('SELECT s.id, s.folio, p.amount_cents FROM payments p JOIN sales s ON s.id = p.sale_id WHERE p.collection_id = ? ORDER BY p.rowid', [r.id]),
    in_cut: !!tx.get(`SELECT 1 FROM cash_movements m JOIN payments p ON m.ref_type = 'payment' AND m.ref_id = p.id WHERE p.collection_id = ? AND m.cut_id IS NOT NULL`, [r.id]),
  }));
}

/** "Últimos Cobros" del cliente (incluye los cancelados, marcados). */
export function clientCollections(tx: Tx, clientId: string, limit = 5) {
  return withSales(tx, tx.all('SELECT * FROM collections WHERE client_id = ? ORDER BY created_at DESC, folio DESC LIMIT ?', [clientId, limit]));
}

/** Cobros que tocaron una venta (para el detalle de la venta). */
export function saleCollections(tx: Tx, saleId: string) {
  return withSales(tx, tx.all('SELECT DISTINCT c.* FROM collections c JOIN payments p ON p.collection_id = c.id WHERE p.sale_id = ? ORDER BY c.created_at DESC', [saleId]));
}

export interface CollectionDetail extends CollectionRow {
  client_name: string | null;
  register_name: string;
  /** Deuda del cliente que queda después de este cobro (a hoy). */
  remaining_debt_cents: number;
  sales: (CollectionRow['sales'][number] & { balance_cents: number })[];
}

export function getCollection(tx: Tx, id: string): CollectionDetail | null {
  const r = tx.get<Omit<CollectionRow, 'sales' | 'in_cut'> & { register_id: string }>('SELECT * FROM collections WHERE id = ?', [id]);
  if (!r) return null;
  const [row] = withSales(tx, [r]);
  const client = r.client_id ? tx.get<{ first_name: string; last_name: string | null }>('SELECT first_name, last_name FROM clients WHERE id = ?', [r.client_id]) : null;
  return {
    ...row,
    client_name: client ? clientName(client) : null,
    register_name: registerName(tx, r.register_id),
    remaining_debt_cents: r.client_id ? clientDebtSummary(tx, r.client_id).total : 0,
    sales: row.sales.map((s) => ({ ...s, balance_cents: tx.get<{ b: number }>(`SELECT ${balanceSql('s')} b FROM sales s WHERE s.id = ?`, [s.id])!.b })),
  };
}
