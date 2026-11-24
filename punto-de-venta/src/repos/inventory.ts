import type { Tx } from '@/db/database';
import { CURRENT_USER, enqueueOutbox, newId, nowIso, rowOf } from './common';

/** Motivos de movimiento. Las Etapas 4 y 5 agregan ajustes, entregas y eliminaciones de venta. */
export type MovementReason = 'initial' | 'adjustment' | 'sale_delivery' | 'sale_deletion';

export interface MovementInput {
  productId: string;
  locationId: string;
  quantity: number; // con signo: + entrada, − salida
  reason: MovementReason;
  description: string; // "Stock inicial", "Entrega de Venta #2524"…
  refType?: string;
  refId?: string;
  createdAt?: string;
}

export interface Movement {
  id: string;
  product_id: string;
  location_id: string;
  location_name: string;
  reason: MovementReason;
  description: string;
  quantity: number;
  stock_before: number;
  stock_after: number;
  user_name: string;
  created_at: string;
}

/** Crea la fila de existencias en 0 si aún no existe. */
export function ensureStockLevel(tx: Tx, productId: string, locationId: string, minQuantity = 0) {
  tx.run(
    `INSERT INTO stock_levels (product_id, location_id, quantity, min_quantity, updated_at)
     VALUES (?, ?, 0, ?, ?) ON CONFLICT (product_id, location_id) DO NOTHING`,
    [productId, locationId, minQuantity, nowIso()],
  );
}

/**
 * Única vía para cambiar existencias: inserta el movimiento (con stock anterior y nuevo) y actualiza el acumulado.
 * Se permite stock negativo (decisions.md D3). Debe llamarse dentro de una transacción `write`.
 */
export function applyMovement(tx: Tx, m: MovementInput) {
  if (!Number.isFinite(m.quantity) || m.quantity === 0) throw new Error('La cantidad del movimiento debe ser distinta de 0');
  ensureStockLevel(tx, m.productId, m.locationId);
  const level = tx.get<{ quantity: number }>('SELECT quantity FROM stock_levels WHERE product_id = ? AND location_id = ?', [m.productId, m.locationId])!;
  const before = level.quantity;
  const after = Math.round((before + m.quantity) * 1000) / 1000;
  const id = newId();
  const at = m.createdAt ?? nowIso();
  tx.run(
    `INSERT INTO inventory_movements (id, product_id, location_id, reason, description, quantity, stock_before, stock_after, ref_type, ref_id, user_name, created_at)
     VALUES (:id, :productId, :locationId, :reason, :description, :quantity, :before, :after, :refType, :refId, :user, :at)`,
    { id, productId: m.productId, locationId: m.locationId, reason: m.reason, description: m.description, quantity: m.quantity, before, after, refType: m.refType ?? null, refId: m.refId ?? null, user: CURRENT_USER, at },
  );
  tx.run('UPDATE stock_levels SET quantity = ?, updated_at = ? WHERE product_id = ? AND location_id = ?', [after, at, m.productId, m.locationId]);
  enqueueOutbox(tx, 'inventory_movement', id, 'upsert', rowOf(tx, 'inventory_movements', id));
  return { id, stockBefore: before, stockAfter: after };
}

export function recentMovements(tx: Tx, productId: string, limit = 10) {
  return tx.all<Movement>(
    `SELECT m.*, l.name AS location_name FROM inventory_movements m JOIN locations l ON l.id = m.location_id
     WHERE m.product_id = ? ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`,
    [productId, limit],
  );
}
