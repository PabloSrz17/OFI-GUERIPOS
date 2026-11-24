import type { Tx } from '@/db/database';
import type { CashMethod } from '@/domain/sale';
import { formatMoney } from '@/lib/format';
import { defaultRegisterId } from './bootstrap';
import { CURRENT_USER, ValidationError, enqueueOutbox, newId, nowIso, rowOf, trimOrNull } from './common';

/**
 * Caja (reference/pulpos/cash.md). La caja no se "abre": acumula movimientos hasta el corte.
 * El periodo actual son los movimientos de la caja sin corte (cut_id NULL). Al cortar, se marcan con el id del corte.
 */

/** Orden de las filas en "Total Esperado" (G-cash-current.png). */
export const CASH_METHODS: CashMethod[] = ['cash', 'credit_card', 'debit_card', 'transfer'];

export type CashMovementType = 'sale' | 'sale_deletion' | 'collection' | 'collection_void' | 'cash_in' | 'cash_out' | 'cash_in_void' | 'cash_out_void';

export interface CashMovementRow {
  id: string;
  register_id: string;
  type: CashMovementType;
  method: CashMethod;
  amount_cents: number;
  description: string;
  ref_type: string | null;
  ref_id: string | null;
  voids_id: string | null;
  cut_id: string | null;
  user_name: string;
  created_at: string;
  /** Folio de la venta, si el movimiento viene de un pago. */
  sale_id: string | null;
  sale_folio: number | null;
}

/** Desglose del "Total Esperado" de un método (G-cash-expected-breakdown.png). */
export interface ExpectedBreakdown {
  method: CashMethod;
  start: number;
  sales: number;
  collections: number;
  cashIn: number;
  cashOut: number;
  /** Ventas eliminadas (negativo). Pulpos muestra "Devoluciones"; aquí no hay devoluciones (D18). */
  deletions: number;
  expected: number;
}

const amount = (c: number) => formatMoney(c / 100);
const MAX_CENTS = 100_000_000_00;

const cutFilter = (cutId: string | null) => (cutId ? 'm.cut_id = :cut' : 'm.cut_id IS NULL');

/** "Al inicio" del periodo: el restante del corte anterior. Sin fondo (D19) siempre es $0, pero se respeta lo guardado. */
function startCents(tx: Tx, registerId: string, cutId: string | null) {
  const before = cutId ? tx.get<{ created_at: string }>('SELECT created_at FROM cash_cuts WHERE id = ?', [cutId])?.created_at : null;
  const prev = tx.get<{ remaining_cents: number }>(
    `SELECT remaining_cents FROM cash_cuts WHERE register_id = ? ${before ? 'AND created_at < ?' : ''} ORDER BY created_at DESC, folio DESC LIMIT 1`,
    before ? [registerId, before] : [registerId],
  );
  return prev?.remaining_cents ?? 0;
}

export function expectedBreakdown(tx: Tx, registerId: string, cutId: string | null = null): ExpectedBreakdown[] {
  const sums = tx.all<{ method: CashMethod; type: CashMovementType; total: number }>(
    `SELECT m.method, m.type, sum(m.amount_cents) total FROM cash_movements m WHERE m.register_id = :reg AND ${cutFilter(cutId)} GROUP BY m.method, m.type`,
    { reg: registerId, cut: cutId },
  );
  const start = startCents(tx, registerId, cutId);
  return CASH_METHODS.map((method) => {
    const get = (...types: CashMovementType[]) => sums.filter((s) => s.method === method && types.includes(s.type)).reduce((a, s) => a + s.total, 0);
    const b = {
      method,
      start: method === 'cash' ? start : 0,
      sales: get('sale'),
      collections: get('collection', 'collection_void'),
      cashIn: get('cash_in', 'cash_in_void'),
      cashOut: get('cash_out', 'cash_out_void'),
      deletions: get('sale_deletion'),
    };
    return { ...b, expected: b.start + b.sales + b.collections + b.cashIn + b.cashOut + b.deletions };
  });
}

const MOVEMENT_SELECT = `SELECT m.*, p.sale_id, s.folio sale_folio FROM cash_movements m
  LEFT JOIN payments p ON m.ref_type = 'payment' AND p.id = m.ref_id
  LEFT JOIN sales s ON s.id = p.sale_id`;

/** Todos los movimientos del periodo (actual o de un corte), del más reciente al más antiguo. */
export function periodMovements(tx: Tx, registerId: string, cutId: string | null = null, method?: CashMethod) {
  return tx.all<CashMovementRow>(
    `${MOVEMENT_SELECT} WHERE m.register_id = :reg AND ${cutFilter(cutId)} ${method ? 'AND m.method = :method' : ''} ORDER BY m.created_at DESC, m.rowid DESC`,
    { reg: registerId, cut: cutId, method: method ?? null },
  );
}

/** Tabla "Ingresos y Retiros de Efectivo": solo los vigentes (los anulados desaparecen, como al eliminarlos en Pulpos). */
export function cashFlows(tx: Tx, registerId: string, cutId: string | null = null) {
  return tx.all<CashMovementRow>(
    `${MOVEMENT_SELECT} WHERE m.register_id = :reg AND ${cutFilter(cutId)} AND m.type IN ('cash_in', 'cash_out')
       AND NOT EXISTS (SELECT 1 FROM cash_movements v WHERE v.voids_id = m.id)
     ORDER BY m.created_at DESC, m.rowid DESC`,
    { reg: registerId, cut: cutId },
  );
}

export function registerName(tx: Tx, registerId: string) {
  return tx.get<{ name: string }>('SELECT name FROM cash_registers WHERE id = ?', [registerId])?.name ?? '';
}

/** Lo que muestra la pantalla Caja. */
export function currentCash(tx: Tx) {
  const registerId = defaultRegisterId(tx);
  const breakdown = expectedBreakdown(tx, registerId);
  return {
    registerId,
    registerName: registerName(tx, registerId),
    breakdown,
    total: breakdown.reduce((a, b) => a + b.expected, 0),
    flows: cashFlows(tx, registerId),
    movementCount: tx.get<{ n: number }>('SELECT count(*) n FROM cash_movements WHERE register_id = ? AND cut_id IS NULL', [registerId])!.n,
  };
}

export interface CashFlowInput {
  /** Id generado al abrir el modal: un doble clic en Confirmar no registra dos veces. */
  id?: string;
  type: 'cash_in' | 'cash_out';
  amountCents: number;
  reason?: string | null;
}

/** "Ingresar Efectivo a Caja" / "Retirar Efectivo de Caja" (G-cash-in-modal.png, G-cash-out-modal.png). */
export function addCashFlow(tx: Tx, input: CashFlowInput) {
  const id = input.id ?? newId();
  const existing = tx.get<{ id: string }>('SELECT id FROM cash_movements WHERE id = ?', [id]);
  if (existing) return { id, duplicate: true };
  const cents = Math.round(input.amountCents);
  if (!Number.isFinite(cents) || cents <= 0) throw new ValidationError('Ingresa un monto mayor a $0', 'amount');
  if (cents > MAX_CENTS) throw new ValidationError('El monto es demasiado grande', 'amount');
  const registerId = defaultRegisterId(tx);
  const reason = trimOrNull(input.reason);
  const description = reason ?? (input.type === 'cash_in' ? 'Ingreso de Efectivo' : 'Retiro de Efectivo');
  tx.run(
    `INSERT INTO cash_movements (id, register_id, type, method, amount_cents, description, user_name, created_at) VALUES (?, ?, ?, 'cash', ?, ?, ?, ?)`,
    [id, registerId, input.type, input.type === 'cash_in' ? cents : -cents, description, CURRENT_USER, nowIso()],
  );
  enqueueOutbox(tx, 'cash_movement', id, 'upsert', rowOf(tx, 'cash_movements', id));
  return { id, duplicate: false };
}

/**
 * Eliminar un ingreso o retiro (D20): no se borra; se agrega un movimiento que lo anula. Solo antes del corte,
 * porque un corte ya cerrado no cambia.
 */
export function voidCashFlow(tx: Tx, id: string) {
  const m = tx.get<{ id: string; register_id: string; type: CashMovementType; amount_cents: number; description: string; cut_id: string | null }>(
    'SELECT id, register_id, type, amount_cents, description, cut_id FROM cash_movements WHERE id = ?',
    [id],
  );
  if (!m || (m.type !== 'cash_in' && m.type !== 'cash_out')) throw new ValidationError('El movimiento no existe');
  if (m.cut_id) throw new ValidationError('Este movimiento ya está en un corte de caja; no se puede eliminar');
  if (tx.get('SELECT 1 FROM cash_movements WHERE voids_id = ?', [id])) return false;
  const vid = newId();
  const label = m.type === 'cash_in' ? 'Ingreso' : 'Retiro';
  tx.run(
    `INSERT INTO cash_movements (id, register_id, type, method, amount_cents, description, voids_id, user_name, created_at) VALUES (?, ?, ?, 'cash', ?, ?, ?, ?, ?)`,
    [vid, m.register_id, `${m.type}_void`, -m.amount_cents, `Eliminación de ${label} de ${amount(Math.abs(m.amount_cents))}: ${m.description}`, id, CURRENT_USER, nowIso()],
  );
  enqueueOutbox(tx, 'cash_movement', vid, 'upsert', rowOf(tx, 'cash_movements', vid));
  return true;
}

export interface CutInput {
  /** Id generado al abrir "Hacer Corte de Caja": el corte es idempotente. */
  id: string;
  /** Recuento manual por método, en centavos (D19: se cuentan todos). */
  counted: Partial<Record<CashMethod, number>>;
  comments?: string | null;
}

/**
 * Hacer Corte de Caja. En una sola transacción: recalcula lo esperado (no confía en la pantalla), guarda el
 * recuento y la diferencia por método, retira todo el efectivo contado (sin fondo, D19) y cierra el periodo
 * marcando sus movimientos con el corte.
 */
export function createCut(tx: Tx, input: CutInput) {
  const dup = tx.get<{ id: string; folio: number }>('SELECT id, folio FROM cash_cuts WHERE id = ?', [input.id]);
  if (dup) return { ...dup, duplicate: true };
  const registerId = defaultRegisterId(tx);
  const n = tx.get<{ n: number }>('SELECT count(*) n FROM cash_movements WHERE register_id = ? AND cut_id IS NULL', [registerId])!.n;
  if (n === 0) throw new ValidationError('No hay movimientos desde el último corte');
  const breakdown = expectedBreakdown(tx, registerId);
  const lines = breakdown.map((b) => {
    const raw = input.counted[b.method];
    const counted = raw === undefined ? b.expected : Math.round(raw);
    if (!Number.isFinite(counted) || counted < 0) throw new ValidationError('El recuento no puede ser negativo', b.method);
    if (counted > MAX_CENTS) throw new ValidationError('El recuento es demasiado grande', b.method);
    return { method: b.method, expected: b.expected, counted };
  });
  const expected = lines.reduce((a, l) => a + l.expected, 0);
  const counted = lines.reduce((a, l) => a + l.counted, 0);
  const cashCounted = lines.find((l) => l.method === 'cash')!.counted;
  const folio = (tx.get<{ n: number | null }>('SELECT max(folio) n FROM cash_cuts')!.n ?? 0) + 1;
  const at = nowIso();
  tx.run(
    `INSERT INTO cash_cuts (id, folio, register_id, start_cents, expected_cents, counted_cents, withdrawn_cents, remaining_cents, comments, user_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [input.id, folio, registerId, breakdown[0].start, expected, counted, cashCounted, trimOrNull(input.comments), CURRENT_USER, at],
  );
  for (const l of lines) tx.run('INSERT INTO cash_cut_lines (cut_id, method, expected_cents, counted_cents) VALUES (?, ?, ?, ?)', [input.id, l.method, l.expected, l.counted]);
  tx.run('UPDATE cash_movements SET cut_id = ? WHERE register_id = ? AND cut_id IS NULL', [input.id, registerId]);
  enqueueOutbox(tx, 'cash_cut', input.id, 'upsert', { cut: rowOf(tx, 'cash_cuts', input.id), lines: tx.all('SELECT * FROM cash_cut_lines WHERE cut_id = ?', [input.id]) });
  return { id: input.id, folio, duplicate: false };
}

export interface CutRow {
  id: string;
  folio: number;
  register_name: string;
  start_cents: number;
  expected_cents: number;
  counted_cents: number;
  difference_cents: number;
  withdrawn_cents: number;
  remaining_cents: number;
  comments: string | null;
  user_name: string;
  created_at: string;
  /** 'pulpos' si se importó (D34): no tiene movimientos, solo lo esperado y contado por método. */
  source: string | null;
}

export type CutSort = 'created-desc' | 'created-asc';
export interface CutFilters {
  from?: string;
  to?: string;
  difference?: 'with' | 'without';
}

const CUT_SELECT = `SELECT c.*, c.counted_cents - c.expected_cents difference_cents, r.name register_name FROM cash_cuts c JOIN cash_registers r ON r.id = c.register_id`;

function cutWhere(q: string, f: CutFilters) {
  const where = ['1 = 1'];
  const params: Record<string, string | number> = {};
  const term = q.trim().toLowerCase();
  if (term) {
    where.push("(lower(r.name) LIKE :q OR lower(c.user_name) LIKE :q OR lower(coalesce(c.comments, '')) LIKE :q)");
    params.q = `%${term}%`;
  }
  if (f.from) (where.push('c.created_at >= :from'), (params.from = f.from));
  if (f.to) (where.push('c.created_at < :to'), (params.to = f.to));
  if (f.difference === 'with') where.push('c.counted_cents <> c.expected_cents');
  if (f.difference === 'without') where.push('c.counted_cents = c.expected_cents');
  return { where: where.join(' AND '), params };
}

/** Cortes Históricos (H-cash-history.png). */
export function listCuts(tx: Tx, query: { q?: string; filters?: CutFilters; sort?: CutSort; page?: number; pageSize?: number } = {}) {
  const { q = '', filters = {}, sort = 'created-desc', page = 1, pageSize = 25 } = query;
  const { where, params } = cutWhere(q, filters);
  const total = tx.get<{ n: number }>(`SELECT count(*) n FROM cash_cuts c JOIN cash_registers r ON r.id = c.register_id WHERE ${where}`, params)!.n;
  const size = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), totalPages);
  const rows = tx.all<CutRow>(`${CUT_SELECT} WHERE ${where} ORDER BY c.created_at ${sort === 'created-asc' ? 'ASC' : 'DESC'}, c.folio ${sort === 'created-asc' ? 'ASC' : 'DESC'} LIMIT :limit OFFSET :offset`, {
    ...params,
    limit: size,
    offset: (current - 1) * size,
  });
  return { rows, total, page: current, totalPages };
}

export interface CutDetail extends CutRow {
  lines: { method: CashMethod; expected_cents: number; counted_cents: number }[];
  breakdown: ExpectedBreakdown[];
  flows: CashMovementRow[];
}

/** Detalle de Corte de Caja (H-cash-cut-detail.png). */
export function getCut(tx: Tx, id: string): CutDetail | null {
  const c = tx.get<CutRow & { register_id: string }>(`${CUT_SELECT} WHERE c.id = ?`, [id]);
  if (!c) return null;
  const lines = tx.all<CutDetail['lines'][number]>('SELECT method, expected_cents, counted_cents FROM cash_cut_lines WHERE cut_id = ?', [id]);
  lines.sort((a, b) => CASH_METHODS.indexOf(a.method) - CASH_METHODS.indexOf(b.method));
  return { ...c, lines, breakdown: expectedBreakdown(tx, c.register_id, id), flows: cashFlows(tx, c.register_id, id) };
}

export function cutRegisterId(tx: Tx, id: string) {
  return tx.get<{ register_id: string }>('SELECT register_id FROM cash_cuts WHERE id = ?', [id])?.register_id ?? null;
}

const csvCell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function cutsCsv(tx: Tx, query: { q?: string; filters?: CutFilters } = {}) {
  const { where, params } = cutWhere(query.q ?? '', query.filters ?? {});
  const rows = tx.all<CutRow>(`${CUT_SELECT} WHERE ${where} ORDER BY c.created_at DESC`, params);
  const head = ['Corte', 'Fecha', 'Caja', 'Realizado por', 'Total Esperado', 'Recuento', 'Diferencia', 'Retiro por corte', 'Comentarios'];
  const pesos = (c: number) => (c / 100).toFixed(2);
  const body = rows.map((r) => [r.folio, r.created_at, r.register_name, r.user_name, pesos(r.expected_cents), pesos(r.counted_cents), pesos(r.difference_cents), pesos(r.withdrawn_cents), r.comments].map(csvCell).join(','));
  return [head.join(','), ...body].join('\n');
}
