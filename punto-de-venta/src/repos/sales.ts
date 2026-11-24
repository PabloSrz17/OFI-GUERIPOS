import { xlsxFile, type XlsxCell, type XlsxColumn } from '@/lib/xlsx';
import type { Tx } from '@/db/database';
import { normalizeSearch, taxRate } from '@/domain/catalog';
import { lineTotals, paymentMethodLabel, saleFolio, type CashMethod, type LineDiscount, type PaymentMethod } from '@/domain/sale';
import { formatMoney } from '@/lib/format';
import { defaultLocationId, defaultRegisterId } from './bootstrap';
import { clientName, effectiveCreditLimit, formatAddress, getClient } from './clients';

type AddressCols = Record<'address_street' | 'address_ext' | 'address_int' | 'address_zip' | 'address_neighborhood' | 'address_municipality' | 'address_city' | 'address_state', string | null>;
import { balanceSql, CURRENT_USER, enqueueOutbox, newId, nowIso, rowOf, trimOrNull, ValidationError } from './common';
import { applyMovement } from './inventory';
import { getSetting } from './settings';

export const CREDIT_DAYS_KEY = 'sales.credit_days';
export const DEFAULT_CREDIT_DAYS = 15; // "Vence en 15 días" (B-sale-detail-debt.png)
export const BLOCK_OVERDUE_KEY = 'clients.block_overdue_credit';

// ---------- Entrada ----------

export interface SaleLineInput {
  /** null = Entrada manual: se vende sin existir en el inventario y sin mover stock. */
  productId?: string | null;
  quantity: number;
  unitPriceCents: number;
  /** null = "Personalizado". */
  priceListId?: string | null;
  discount?: LineDiscount | null;
  // Solo para la entrada manual:
  name?: string;
  unit?: string;
  costCents?: number;
  chargeTaxes?: boolean;
  iva?: string;
  ieps?: string;
}

export type DeliveryMethod = 'pickup' | 'shipping';
export const DELIVERY_METHODS: { value: DeliveryMethod; label: string }[] = [
  { value: 'pickup', label: 'Recoge en Tienda' },
  { value: 'shipping', label: 'Envío a Domicilio' },
];

export interface SaleInput {
  /** Generado por el carrito antes de cobrar: llave de idempotencia. */
  id: string;
  mode?: 'sale' | 'order';
  clientId?: string | null;
  priceListId?: string | null;
  note?: string | null;
  taxesRemoved?: boolean;
  /** "Posponer Entrega de Productos": se cobra ahora y el stock baja al entregar. Los pedidos siempre se entregan después. */
  deferDelivery?: boolean;
  /** Forma de Entrega (D42): las de envío pasan al tablero de reparto de la Oficina Virtual. */
  deliveryMethod?: DeliveryMethod | null;
  lines: SaleLineInput[];
  payment: { method: PaymentMethod; receivedCents?: number | null };
  createdAt?: string;
}

// ---------- SQL compartido ----------

export { balanceSql };


function locationName(tx: Tx, id: string) {
  return tx.get<{ name: string }>('SELECT name FROM locations WHERE id = ?', [id])?.name ?? '';
}
function registerName(tx: Tx, id: string) {
  return tx.get<{ name: string }>('SELECT name FROM cash_registers WHERE id = ?', [id])?.name ?? '';
}

export function addEvent(tx: Tx, saleId: string, type: string, title: string, detail: string | null, at = nowIso()) {
  tx.run('INSERT INTO sale_events (id, sale_id, type, title, detail, user_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [newId(), saleId, type, title, detail, CURRENT_USER, at]);
}

/** Deuda vigente del cliente (ventas no eliminadas con saldo). */
export function clientDebtCents(tx: Tx, clientId: string) {
  return tx.get<{ d: number }>(`SELECT coalesce(sum(${balanceSql('s')}), 0) AS d FROM sales s WHERE s.client_id = ? AND s.deleted_at IS NULL`, [clientId])!.d;
}

export function clientOverdueCents(tx: Tx, clientId: string, now = nowIso()) {
  return tx.get<{ d: number }>(`SELECT coalesce(sum(${balanceSql('s')}), 0) AS d FROM sales s WHERE s.client_id = ? AND s.deleted_at IS NULL AND s.due_date IS NOT NULL AND s.due_date < ?`, [clientId, now])!.d;
}

// ---------- Registrar venta ----------

interface ResolvedLine {
  productId: string | null;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  unitPriceCents: number;
  priceListId: string | null;
  discount: LineDiscount | null;
  taxRate: number;
  costCents: number;
  trackStock: boolean;
}

function resolveLine(tx: Tx, l: SaleLineInput, i: number): ResolvedLine {
  if (!Number.isFinite(l.quantity) || l.quantity <= 0) throw new ValidationError(`La cantidad del renglón ${i + 1} debe ser mayor a 0`, 'lines');
  if (!Number.isInteger(l.unitPriceCents) || l.unitPriceCents < 0) throw new ValidationError(`El precio del renglón ${i + 1} no es válido`, 'lines');
  const discount = l.discount && l.discount.value > 0 ? { ...l.discount, label: trimOrNull(l.discount.label) } : null;
  if (l.productId) {
    const p = tx.get<{ name: string; sku: string | null; unit: string; cost_cents: number; charge_taxes: number; iva: string; ieps: string; track_stock: number; type: string }>(
      'SELECT name, sku, unit, cost_cents, charge_taxes, iva, ieps, track_stock, type FROM products WHERE id = ? AND deleted_at IS NULL',
      [l.productId],
    );
    if (!p) throw new ValidationError(`Un producto del carrito ya no existe (renglón ${i + 1})`, 'lines');
    return {
      productId: l.productId,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      priceListId: l.priceListId ?? null,
      discount,
      taxRate: taxRate({ chargeTaxes: !!p.charge_taxes, iva: p.iva, ieps: p.ieps }),
      costCents: p.cost_cents,
      trackStock: p.type === 'product' && !!p.track_stock,
    };
  }
  const name = trimOrNull(l.name);
  if (!name) throw new ValidationError(`Falta el nombre del producto manual (renglón ${i + 1})`, 'lines');
  return {
    productId: null,
    name,
    sku: null,
    unit: l.unit ?? 'unit',
    quantity: l.quantity,
    unitPriceCents: l.unitPriceCents,
    priceListId: null,
    discount,
    taxRate: taxRate({ chargeTaxes: l.chargeTaxes ?? true, iva: l.iva ?? '16', ieps: l.ieps ?? 'none' }),
    costCents: Math.max(0, Math.round(l.costCents ?? 0)),
    trackStock: false,
  };
}

/**
 * Registra la venta completa en UNA transacción: encabezado, renglones, pago, movimiento de caja,
 * movimientos de inventario (si se entrega) e historial. Si algo falla no queda nada a medias.
 * Idempotente: si ya existe una venta con ese id, la devuelve sin volver a registrarla.
 */
export function createSale(tx: Tx, input: SaleInput): { id: string; folio: number; changeCents: number; duplicate: boolean } {
  const existing = tx.get<{ folio: number; change_cents: number }>('SELECT folio, change_cents FROM sales WHERE id = ?', [input.id]);
  if (existing) return { id: input.id, folio: existing.folio, changeCents: existing.change_cents, duplicate: true };
  if (!input.lines.length) throw new ValidationError('El carrito está vacío');

  const mode = input.mode ?? 'sale';
  const lines = input.lines.map((l, i) => resolveLine(tx, l, i));
  const totals = lines.map((l) => lineTotals(l, !!input.taxesRemoved));
  const sum = (k: keyof (typeof totals)[number]) => totals.reduce((s, t) => s + t[k], 0);
  const totalCents = sum('totalCents');
  const method = input.payment.method;

  let client = null;
  if (input.clientId) {
    client = getClient(tx, input.clientId);
    if (!client) throw new ValidationError('El cliente ya no existe', 'client');
  }

  let receivedCents: number | null = null;
  let changeCents = 0;
  let creditCents = 0;
  let dueDate: string | null = null;
  const at = input.createdAt ?? nowIso();

  if (method === 'credit') {
    if (!client) throw new ValidationError('Para vender a crédito asigna un cliente a la venta', 'client');
    if (getSetting(tx, BLOCK_OVERDUE_KEY, false) && clientOverdueCents(tx, client.id, at) > 0)
      throw new ValidationError('El cliente tiene una deuda vencida; no se le puede vender a crédito', 'payment');
    const limit = effectiveCreditLimit(tx, client);
    const debt = clientDebtCents(tx, client.id);
    if (limit !== null && debt + totalCents > limit)
      throw new ValidationError(`La venta excede el límite de crédito del cliente. Disponible: ${formatMoney(Math.max(0, limit - debt) / 100)}`, 'payment');
    creditCents = totalCents;
    const days = getSetting(tx, CREDIT_DAYS_KEY, DEFAULT_CREDIT_DAYS);
    dueDate = new Date(new Date(at).getTime() + days * 86_400_000).toISOString();
  } else if (method === 'cash') {
    receivedCents = input.payment.receivedCents ?? totalCents;
    if (!Number.isInteger(receivedCents) || receivedCents < totalCents) throw new ValidationError('El efectivo recibido no cubre el total', 'payment');
    changeCents = receivedCents - totalCents;
  }

  const locationId = defaultLocationId(tx);
  const registerId = defaultRegisterId(tx);
  const folio = tx.get<{ n: number }>('SELECT coalesce(max(folio), 0) + 1 AS n FROM sales')!.n;
  const delivered = mode === 'sale' && !input.deferDelivery;
  const label = saleFolio(folio);

  tx.run(
    `INSERT INTO sales (id, folio, mode, location_id, register_id, client_id, price_list_id, note, taxes_removed, subtotal_cents, discount_cents, taxes_removed_cents,
       tax_cents, total_cents, payment_method, received_cents, change_cents, credit_cents, due_date, delivery_status, delivered_at, delivery_method, user_name, created_at, updated_at)
     VALUES (:id, :folio, :mode, :loc, :reg, :client, :pl, :note, :tr, :sub, :disc, :trc, :tax, :total, :method, :recv, :change, :credit, :due, :ds, :dat, :dm, :user, :at, :at)`,
    {
      id: input.id,
      folio,
      mode,
      loc: locationId,
      reg: registerId,
      client: client?.id ?? null,
      pl: input.priceListId ?? null,
      note: trimOrNull(input.note),
      tr: input.taxesRemoved ? 1 : 0,
      sub: sum('grossCents'),
      disc: sum('discountCents'),
      trc: sum('taxesRemovedCents'),
      tax: sum('taxCents'),
      total: totalCents,
      method,
      recv: receivedCents,
      change: changeCents,
      credit: creditCents,
      due: dueDate,
      ds: delivered ? 'delivered' : 'pending',
      dat: delivered ? at : null,
      dm: input.deliveryMethod === 'shipping' || input.deliveryMethod === 'pickup' ? input.deliveryMethod : null,
      user: CURRENT_USER,
      at,
    },
  );

  lines.forEach((l, i) => {
    const t = totals[i];
    tx.run(
      `INSERT INTO sale_items (id, sale_id, position, product_id, name, sku, unit, quantity, unit_price_cents, price_list_id, gross_cents, discount_cents, discount_label,
         taxes_removed_cents, total_cents, tax_rate, tax_cents, cost_cents, track_stock)
       VALUES (:id, :sale, :pos, :pid, :name, :sku, :unit, :qty, :price, :pl, :gross, :disc, :dl, :trc, :total, :rate, :tax, :cost, :track)`,
      {
        id: newId(),
        sale: input.id,
        pos: i,
        pid: l.productId,
        name: l.name,
        sku: l.sku,
        unit: l.unit,
        qty: l.quantity,
        price: l.unitPriceCents,
        pl: l.priceListId,
        gross: t.grossCents,
        disc: t.discountCents,
        dl: l.discount?.label ?? null,
        trc: t.taxesRemovedCents,
        total: t.totalCents,
        rate: l.taxRate,
        tax: t.taxCents,
        cost: l.costCents,
        track: l.trackStock ? 1 : 0,
      },
    );
  });

  const where = `${CURRENT_USER} en ${locationName(tx, locationId)}`;
  const inRegister = `${CURRENT_USER} en ${registerName(tx, registerId)}`;
  addEvent(tx, input.id, 'created', mode === 'order' ? 'Pedido Registrado' : 'Venta Registrada', where, at);

  if (method === 'credit') {
    addEvent(tx, input.id, 'credit', `Asignación de ${formatMoney(totalCents / 100)} de Crédito`, inRegister, at);
  } else if (totalCents > 0) {
    recordPayment(tx, { saleId: input.id, clientId: client?.id ?? null, registerId, kind: 'sale', method, amountCents: totalCents, description: `Venta ${label}`, at });
    addEvent(tx, input.id, 'payment', `Cobro de ${formatMoney(totalCents / 100)} en ${paymentMethodLabel(method)}`, inRegister, at);
  }

  if (delivered) deliverItems(tx, input.id, folio, locationId, at);
  else addEvent(tx, input.id, 'reserved', 'Apartado de Productos', where, at);

  enqueueOutbox(tx, 'sale', input.id, 'upsert', { sale: rowOf(tx, 'sales', input.id), items: tx.all('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY position', [input.id]) });
  return { id: input.id, folio, changeCents, duplicate: false };
}

interface PaymentRecord {
  saleId: string;
  clientId: string | null;
  registerId: string;
  kind: 'sale' | 'collection';
  method: CashMethod;
  amountCents: number;
  description: string;
  at: string;
}

/** Pago + su asiento en el libro de caja (misma transacción). */
export function recordPayment(tx: Tx, p: PaymentRecord): string {
  const id = newId();
  tx.run(
    'INSERT INTO payments (id, sale_id, client_id, register_id, kind, method, amount_cents, user_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, p.saleId, p.clientId, p.registerId, p.kind, p.method, p.amountCents, CURRENT_USER, p.at],
  );
  const mid = newId();
  tx.run(
    `INSERT INTO cash_movements (id, register_id, type, method, amount_cents, description, ref_type, ref_id, user_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'payment', ?, ?, ?)`,
    [mid, p.registerId, p.kind === 'sale' ? 'sale' : 'collection', p.method, p.amountCents, p.description, id, CURRENT_USER, p.at],
  );
  enqueueOutbox(tx, 'payment', id, 'upsert', rowOf(tx, 'payments', id));
  enqueueOutbox(tx, 'cash_movement', mid, 'upsert', rowOf(tx, 'cash_movements', mid));
  return id;
}

function deliverItems(tx: Tx, saleId: string, folio: number, locationId: string, at: string) {
  const items = tx.all<{ product_id: string; quantity: number }>('SELECT product_id, quantity FROM sale_items WHERE sale_id = ? AND product_id IS NOT NULL AND track_stock = 1 ORDER BY position', [saleId]);
  for (const it of items)
    applyMovement(tx, { productId: it.product_id, locationId, quantity: -it.quantity, reason: 'sale_delivery', description: `Entrega de Venta #${Math.abs(folio)}`, refType: 'sale', refId: saleId, createdAt: at });
  addEvent(tx, saleId, 'delivery', 'Entrega de Productos', `${CURRENT_USER} en ${locationName(tx, locationId)}`, at);
}

function activeSale(tx: Tx, id: string) {
  const s = tx.get<{ id: string; folio: number; location_id: string; delivery_status: string; deleted_at: string | null }>('SELECT id, folio, location_id, delivery_status, deleted_at FROM sales WHERE id = ?', [id]);
  if (!s || s.deleted_at) throw new ValidationError('La venta no existe o fue eliminada');
  return s;
}

/** "Entregar Productos": descuenta el stock de una venta apartada o pedido. */
export function deliverSale(tx: Tx, id: string) {
  const s = activeSale(tx, id);
  if (s.delivery_status === 'delivered') return false;
  const at = nowIso();
  deliverItems(tx, id, s.folio, s.location_id, at);
  tx.run("UPDATE sales SET delivery_status = 'delivered', delivered_at = ?, updated_at = ? WHERE id = ?", [at, at, id]);
  enqueueOutbox(tx, 'sale', id, 'upsert', { sale: rowOf(tx, 'sales', id) });
  return true;
}

/**
 * Eliminar venta: regresa el stock entregado con movimientos "Eliminación de Venta #N" (Entrada) y
 * descuenta de la caja lo cobrado. No borra nada: la venta queda marcada y su historial se conserva.
 */
export function deleteSale(tx: Tx, id: string) {
  const s = activeSale(tx, id);
  // Lo cobrado y entregado de una venta importada pasó por la caja y el inventario de Pulpos, no por los de aquí (D34).
  if (tx.get("SELECT 1 FROM sales WHERE id = ? AND source = 'pulpos'", [id])) throw new ValidationError('Esta venta se importó de Pulpos y no se puede eliminar aquí');
  const at = nowIso();
  if (s.delivery_status === 'delivered') {
    const items = tx.all<{ product_id: string; quantity: number }>('SELECT product_id, quantity FROM sale_items WHERE sale_id = ? AND product_id IS NOT NULL AND track_stock = 1 ORDER BY position', [id]);
    for (const it of items)
      applyMovement(tx, { productId: it.product_id, locationId: s.location_id, quantity: it.quantity, reason: 'sale_deletion', description: `Eliminación de Venta #${Math.abs(s.folio)}`, refType: 'sale', refId: id, createdAt: at });
  }
  const pays = tx.all<{ id: string; register_id: string; method: CashMethod; amount_cents: number }>('SELECT id, register_id, method, amount_cents FROM payments WHERE sale_id = ? AND reversed_at IS NULL', [id]);
  for (const p of pays) {
    tx.run('UPDATE payments SET reversed_at = ? WHERE id = ?', [at, p.id]);
    const mid = newId();
    tx.run(
      `INSERT INTO cash_movements (id, register_id, type, method, amount_cents, description, ref_type, ref_id, user_name, created_at)
       VALUES (?, ?, 'sale_deletion', ?, ?, ?, 'payment', ?, ?, ?)`,
      [mid, p.register_id, p.method, -p.amount_cents, `Eliminación de Venta ${saleFolio(s.folio)}`, p.id, CURRENT_USER, at],
    );
    enqueueOutbox(tx, 'cash_movement', mid, 'upsert', rowOf(tx, 'cash_movements', mid));
  }
  tx.run('UPDATE sales SET deleted_at = ?, updated_at = ? WHERE id = ?', [at, at, id]);
  addEvent(tx, id, 'deleted', 'Venta Eliminada', CURRENT_USER, at);
  enqueueOutbox(tx, 'sale', id, 'delete', { sale: rowOf(tx, 'sales', id) });
}

export function addSaleComment(tx: Tx, id: string, text: string) {
  const t = trimOrNull(text);
  if (!t) throw new ValidationError('Escribe un comentario', 'comment');
  if (!tx.get('SELECT id FROM sales WHERE id = ?', [id])) throw new ValidationError('La venta no existe');
  addEvent(tx, id, 'comment', t, CURRENT_USER);
}

export function setSaleNote(tx: Tx, id: string, note: string | null) {
  activeSale(tx, id);
  tx.run('UPDATE sales SET note = ?, updated_at = ? WHERE id = ?', [trimOrNull(note), nowIso(), id]);
  enqueueOutbox(tx, 'sale', id, 'upsert', { sale: rowOf(tx, 'sales', id) });
}

/** Asignar o quitar cliente después de vender. Una venta a crédito no puede quedarse sin cliente. */
export function setSaleClient(tx: Tx, id: string, clientId: string | null) {
  activeSale(tx, id);
  const s = tx.get<{ payment_method: string; credit_cents: number; client_id: string | null }>('SELECT payment_method, credit_cents, client_id FROM sales WHERE id = ?', [id])!;
  if (s.credit_cents > 0 && clientId !== s.client_id) throw new ValidationError('El cliente de una venta a crédito no se puede cambiar');
  if (clientId && !getClient(tx, clientId)) throw new ValidationError('El cliente ya no existe');
  tx.run('UPDATE sales SET client_id = ?, updated_at = ? WHERE id = ?', [clientId, nowIso(), id]);
  tx.run('UPDATE payments SET client_id = ? WHERE sale_id = ?', [clientId, id]);
  enqueueOutbox(tx, 'sale', id, 'upsert', { sale: rowOf(tx, 'sales', id) });
}

// ---------- Consultas ----------

export type SalesTab = 'all' | 'pending_payment' | 'undelivered';
export type SaleSort = 'created-desc' | 'created-asc' | 'total-desc' | 'total-asc';

export interface SaleFilters {
  from?: string; // fecha ISO (incluida)
  to?: string; // fecha ISO (excluida)
  method?: PaymentMethod;
  clientId?: string;
  payment?: 'paid' | 'debt';
  delivery?: 'delivered' | 'pending';
  discount?: 'with' | 'without';
}

export interface SaleRow {
  id: string;
  folio: number;
  mode: 'sale' | 'order';
  created_at: string;
  client_id: string | null;
  client_first_name: string | null;
  client_last_name: string | null;
  total_cents: number;
  balance_cents: number;
  payment_method: PaymentMethod;
  delivery_status: 'delivered' | 'pending';
  user_name: string;
}

function salesWhere(q: string, tab: SalesTab, f: SaleFilters) {
  const where = ['s.deleted_at IS NULL'];
  const params: Record<string, string | number> = {};
  const term = normalizeSearch(q);
  if (term) {
    const folio = term.replace(/^#?n?/, '');
    params.like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const parts = [
      `EXISTS (SELECT 1 FROM clients c2 WHERE c2.id = s.client_id AND c2.search_text LIKE :like ESCAPE '\\')`,
      `EXISTS (SELECT 1 FROM sale_items i2 LEFT JOIN products p2 ON p2.id = i2.product_id WHERE i2.sale_id = s.id AND (lower(i2.name) LIKE :like ESCAPE '\\' OR p2.search_text LIKE :like ESCAPE '\\'))`,
      `lower(s.user_name) LIKE :like ESCAPE '\\'`,
    ];
    if (/^\d+$/.test(folio)) {
      parts.push(term.startsWith('#') ? 's.folio IN (:folio, -:folio)' : 's.folio = :folio');
      params.folio = Number(folio);
    }
    where.push(`(${parts.join(' OR ')})`);
  }
  const bal = balanceSql('s');
  if (tab === 'pending_payment' || f.payment === 'debt') where.push(`${bal} > 0`);
  if (f.payment === 'paid') where.push(`${bal} <= 0`);
  if (tab === 'undelivered' || f.delivery === 'pending') where.push("s.delivery_status = 'pending'");
  if (f.delivery === 'delivered') where.push("s.delivery_status = 'delivered'");
  if (f.from) {
    where.push('s.created_at >= :from');
    params.from = f.from;
  }
  if (f.to) {
    where.push('s.created_at < :to');
    params.to = f.to;
  }
  if (f.method) {
    where.push('s.payment_method = :method');
    params.method = f.method;
  }
  if (f.clientId) {
    where.push('s.client_id = :clientId');
    params.clientId = f.clientId;
  }
  if (f.discount === 'with') where.push('s.discount_cents > 0');
  if (f.discount === 'without') where.push('s.discount_cents = 0');
  return { where: where.join(' AND '), params };
}

const SORT_SQL: Record<SaleSort, string> = {
  'created-desc': 's.created_at DESC, s.folio DESC',
  'created-asc': 's.created_at ASC, s.folio ASC',
  'total-desc': 's.total_cents DESC, s.folio DESC',
  'total-asc': 's.total_cents ASC, s.folio ASC',
};

export function listSales(tx: Tx, query: { q?: string; tab?: SalesTab; filters?: SaleFilters; sort?: SaleSort; page?: number; pageSize?: number } = {}) {
  const { q = '', tab = 'all', filters = {}, sort = 'created-desc', page = 1, pageSize = 25 } = query;
  const { where, params } = salesWhere(q, tab, filters);
  const total = tx.get<{ n: number }>(`SELECT count(*) AS n FROM sales s WHERE ${where}`, params)!.n;
  const size = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), totalPages);
  const rows = tx.all<SaleRow>(
    `SELECT s.id, s.folio, s.mode, s.created_at, s.client_id, c.first_name AS client_first_name, c.last_name AS client_last_name, s.total_cents,
            ${balanceSql('s')} AS balance_cents, s.payment_method, s.delivery_status, s.user_name
     FROM sales s LEFT JOIN clients c ON c.id = s.client_id
     WHERE ${where} ORDER BY ${SORT_SQL[sort] ?? SORT_SQL['created-desc']} LIMIT :limit OFFSET :offset`,
    { ...params, limit: size, offset: (current - 1) * size },
  );
  // Contadores de las pestañas "Pagos Pendientes" y "No Entregadas" (sobre todas las ventas, como en Pulpos).
  const counts = tx.get<{ pending: number; undelivered: number }>(
    `SELECT sum(CASE WHEN ${balanceSql('s')} > 0 THEN 1 ELSE 0 END) AS pending, sum(CASE WHEN s.delivery_status = 'pending' THEN 1 ELSE 0 END) AS undelivered
     FROM sales s WHERE s.deleted_at IS NULL`,
  )!;
  return { rows, total, page: current, totalPages, counts: { pending: counts.pending ?? 0, undelivered: counts.undelivered ?? 0 } };
}

export interface SaleItem {
  id: string;
  product_id: string | null;
  product_exists: number;
  image: string | null;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  unit_price_cents: number;
  price_list_id: string | null;
  gross_cents: number;
  discount_cents: number;
  discount_label: string | null;
  taxes_removed_cents: number;
  total_cents: number;
  tax_cents: number;
}

export interface SaleEvent {
  id: string;
  type: string;
  title: string;
  detail: string | null;
  user_name: string;
  created_at: string;
}

export interface SaleDetail {
  id: string;
  folio: number;
  mode: 'sale' | 'order';
  client_id: string | null;
  client_name: string | null;
  client_phone: string | null;
  /** Dirección registrada del cliente (se imprime como Dirección de Entrega). */
  client_address: string | null;
  location_name: string;
  register_name: string;
  note: string | null;
  taxes_removed: number;
  subtotal_cents: number;
  discount_cents: number;
  taxes_removed_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  payment_method: PaymentMethod;
  received_cents: number | null;
  change_cents: number;
  credit_cents: number;
  due_date: string | null;
  delivery_status: 'delivered' | 'pending';
  /** Forma de Entrega (D42); NULL en ventas anteriores. */
  delivery_method: DeliveryMethod | null;
  user_name: string;
  created_at: string;
  deleted_at: string | null;
  items: SaleItem[];
  events: SaleEvent[];
}

export function getSale(tx: Tx, id: string): SaleDetail | null {
  const s = tx.get<Omit<SaleDetail, 'items' | 'events' | 'client_name' | 'client_phone' | 'client_address'> & AddressCols & { client_first_name: string | null; client_last_name: string | null; client_phone_country: string | null; client_phone_number: string | null }>(
    `SELECT s.*, l.name AS location_name, r.name AS register_name, c.first_name AS client_first_name, c.last_name AS client_last_name,
            c.phone_country AS client_phone_country, c.phone AS client_phone_number,
            c.address_street, c.address_ext, c.address_int, c.address_zip, c.address_neighborhood, c.address_municipality, c.address_city, c.address_state,
            s.total_cents - ${balanceSql('s')} AS paid_cents, ${balanceSql('s')} AS balance_cents
     FROM sales s JOIN locations l ON l.id = s.location_id JOIN cash_registers r ON r.id = s.register_id
     LEFT JOIN clients c ON c.id = s.client_id WHERE s.id = ?`,
    [id],
  );
  if (!s) return null;
  const items = tx.all<SaleItem>(
    `SELECT i.*, p.image, CASE WHEN p.id IS NOT NULL AND p.deleted_at IS NULL THEN 1 ELSE 0 END AS product_exists
     FROM sale_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.sale_id = ? ORDER BY i.position`,
    [id],
  );
  const events = tx.all<SaleEvent>('SELECT id, type, title, detail, user_name, created_at FROM sale_events WHERE sale_id = ? ORDER BY created_at DESC, rowid DESC', [id]);
  const { client_first_name, client_last_name, client_phone_country, client_phone_number, address_street, address_ext, address_int, address_zip, address_neighborhood, address_municipality, address_city, address_state, ...rest } = s;
  const address = s.client_id ? formatAddress({ address_street, address_ext, address_int, address_zip, address_neighborhood, address_municipality, address_city, address_state }) : '';
  return {
    ...rest,
    client_name: client_first_name ? clientName({ first_name: client_first_name, last_name: client_last_name }) : null,
    client_phone: client_phone_number ? `${client_phone_country}${client_phone_number}` : null,
    client_address: address || null,
    items,
    events,
  };
}

/** Últimas ventas de un cliente (detalle del cliente). */
export function clientRecentSales(tx: Tx, clientId: string, limit = 5) {
  return tx.all<{ id: string; folio: number; created_at: string; total_cents: number; balance_cents: number; delivery_status: string; due_date: string | null }>(
    `SELECT s.id, s.folio, s.created_at, s.total_cents, ${balanceSql('s')} AS balance_cents, s.delivery_status, s.due_date
     FROM sales s WHERE s.client_id = ? AND s.deleted_at IS NULL ORDER BY s.created_at DESC, s.folio DESC LIMIT ?`,
    [clientId, limit],
  );
}

/** Columnas de "Descargar Ventas" (.xlsx): exactamente estas cinco, en este orden. */
export const SALES_REPORT_COLUMNS: XlsxColumn[] = [
  { header: 'NUMERO DE VENTA #TICKET' },
  { header: 'CLIENTE' },
  { header: 'ESTADO' },
  { header: 'TOTAL', type: 'money' },
  { header: 'DEUDA ACTIVA', type: 'money' },
];

/** Ventas de un periodo [from, to) (ISO), de la más reciente a la más antigua: folio, cliente, estado, total y deuda (en pesos). */
export function salesReportRows(tx: Tx, range: { from: string; to: string }): XlsxCell[][] {
  const { where, params } = salesWhere('', 'all', { from: range.from, to: range.to });
  const rows = tx.all<{ folio: number; total_cents: number; balance_cents: number; client_first_name: string | null; client_last_name: string | null }>(
    `SELECT s.folio, s.total_cents, ${balanceSql('s')} AS balance_cents, c.first_name AS client_first_name, c.last_name AS client_last_name
     FROM sales s LEFT JOIN clients c ON c.id = s.client_id WHERE ${where} ORDER BY s.created_at DESC, s.folio DESC`,
    params,
  );
  return rows.map((r) => [
    saleFolio(r.folio),
    r.client_first_name ? clientName({ first_name: r.client_first_name, last_name: r.client_last_name }) : 'Público General',
    r.balance_cents > 0 ? 'Deuda pendiente' : 'Pagada',
    r.total_cents / 100,
    r.balance_cents / 100,
  ]);
}

export function salesReportXlsx(tx: Tx, range: { from: string; to: string }) {
  return xlsxFile('Ventas', SALES_REPORT_COLUMNS, salesReportRows(tx, range));
}

// ---------- Búsqueda del punto de venta ----------

export interface PosProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  image: string | null;
  unit: string;
  type: 'product' | 'service';
  track_stock: number;
  stock: number;
  price_cents: number;
  price_list_id: string | null;
}

/**
 * Productos visibles en el POS que coinciden con la búsqueda, con el precio de la lista elegida
 * (si el producto no tiene precio en esa lista, se usa el de la lista principal). El código de barras exacto va primero.
 */
export function posSearch(tx: Tx, q: string, priceListId: string | null, limit = 20): PosProduct[] {
  const raw = q.trim();
  const terms = normalizeSearch(raw).split(' ').filter(Boolean);
  if (!terms.length) return [];
  const params: Record<string, string | number | null> = { raw, pl: priceListId, limit };
  const conds = terms.map((t, i) => {
    params[`t${i}`] = `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    return `p.search_text LIKE :t${i} ESCAPE '\\'`;
  });
  return tx.all<PosProduct>(
    `SELECT p.id, p.name, p.sku, p.barcode, p.image, p.unit, p.type, p.track_stock, coalesce((SELECT sum(quantity) FROM stock_levels s WHERE s.product_id = p.id), 0) AS stock,
            ${PRICE_SQL} AS price_cents, ${PRICE_LIST_SQL} AS price_list_id
     FROM products p
     WHERE p.deleted_at IS NULL AND p.sell_in_pos = 1 AND ((${conds.join(' AND ')}) OR p.barcode = :raw OR lower(p.sku) = lower(:raw))
     ORDER BY CASE WHEN p.barcode = :raw OR lower(p.sku) = lower(:raw) THEN 0 ELSE 1 END, p.name COLLATE NOCASE LIMIT :limit`,
    params,
  );
}

const MAIN_LIST_SQL = '(SELECT id FROM price_lists WHERE deleted_at IS NULL ORDER BY position, created_at LIMIT 1)';
const PRICE_SQL = `coalesce((SELECT price_cents FROM product_prices WHERE product_id = p.id AND price_list_id = :pl), (SELECT price_cents FROM product_prices WHERE product_id = p.id AND price_list_id = ${MAIN_LIST_SQL}), 0)`;
const PRICE_LIST_SQL = `CASE WHEN EXISTS (SELECT 1 FROM product_prices WHERE product_id = p.id AND price_list_id = :pl) THEN :pl ELSE ${MAIN_LIST_SQL} END`;

/** Producto exacto por código de barras o SKU (lector de códigos). */
export function posFindByCode(tx: Tx, code: string, priceListId: string | null): PosProduct | null {
  const raw = code.trim();
  if (!raw) return null;
  return (
    tx.get<PosProduct>(
      `SELECT p.id, p.name, p.sku, p.barcode, p.image, p.unit, p.type, p.track_stock, coalesce((SELECT sum(quantity) FROM stock_levels s WHERE s.product_id = p.id), 0) AS stock,
              ${PRICE_SQL} AS price_cents, ${PRICE_LIST_SQL} AS price_list_id
       FROM products p WHERE p.deleted_at IS NULL AND p.sell_in_pos = 1 AND (p.barcode = :raw OR lower(p.sku) = lower(:raw)) LIMIT 1`,
      { raw, pl: priceListId },
    ) ?? null
  );
}

/** Precios de varios productos en todas las listas (para "Cambiar Precio" y para cambiar la lista del carrito). */
export function productPriceMap(tx: Tx, productIds: string[]) {
  if (!productIds.length) return {} as Record<string, Record<string, number>>;
  const rows = tx.all<{ product_id: string; price_list_id: string; price_cents: number }>(
    `SELECT pp.product_id, pp.price_list_id, pp.price_cents FROM product_prices pp JOIN price_lists pl ON pl.id = pp.price_list_id AND pl.deleted_at IS NULL
     WHERE pp.product_id IN (${productIds.map(() => '?').join(', ')})`,
    productIds,
  );
  const map: Record<string, Record<string, number>> = {};
  for (const r of rows) (map[r.product_id] ??= {})[r.price_list_id] = r.price_cents;
  return map;
}
