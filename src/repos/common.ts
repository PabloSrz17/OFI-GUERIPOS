import { uuid } from '@/lib/uuid';
import type { Tx } from '@/db/database';

export const newId = () => uuid();
export const nowIso = () => new Date().toISOString();

/** Hasta que existan usuarios (fuera del alcance actual), todos los movimientos se firman con este nombre. */
export const CURRENT_USER = 'Administrador';

/** Error de validación con mensaje para mostrar al usuario y campo al que pertenece. */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export type OutboxEntity = 'category' | 'brand' | 'price_list' | 'product' | 'inventory_movement' | 'location' | 'client' | 'setting' | 'cash_register' | 'sale' | 'payment' | 'cash_movement';

/** Encola un evento de sincronización en la misma transacción del cambio (Transactional Outbox). */
export function enqueueOutbox(tx: Tx, entity: OutboxEntity, entityId: string, op: 'upsert' | 'delete', payload: unknown) {
  tx.run(
    'INSERT INTO outbox (id, entity, entity_id, op, payload, created_at) VALUES (:id, :entity, :entityId, :op, :payload, :createdAt)',
    { id: newId(), entity, entityId, op, payload: JSON.stringify(payload), createdAt: nowIso() },
  );
}

/** Recupera la fila tal como está guardada, para mandarla completa en el evento. */
export function rowOf(tx: Tx, table: string, id: string) {
  return tx.get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
}

export function trimOrNull(s: string | null | undefined) {
  const t = (s ?? '').trim();
  return t ? t : null;
}

/** Traduce los errores de índices únicos de SQLite a mensajes en español. */
export function translateConstraint(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('products.sku')) throw new ValidationError('Ya existe un producto con este SKU', 'sku');
  if (msg.includes('products.barcode')) throw new ValidationError('Ya existe un producto con este código de barras', 'barcode');
  if (msg.includes('categories.name')) throw new ValidationError('Ya existe una categoría con este nombre', 'name');
  if (msg.includes('brands.name')) throw new ValidationError('Ya existe una marca con este nombre', 'brand');
  if (msg.includes('price_lists.name')) throw new ValidationError('Ya existe una lista de precios con este nombre', 'name');
  throw err;
}

/** Lo que falta por pagar de una venta (alias de la tabla sales): total − pagos vigentes. */
export const balanceSql = (alias: string) =>
  `(${alias}.total_cents - coalesce((SELECT sum(p.amount_cents) FROM payments p WHERE p.sale_id = ${alias}.id AND p.reversed_at IS NULL), 0))`;
