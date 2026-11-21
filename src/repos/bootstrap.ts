import type { Tx } from '@/db/database';
import { enqueueOutbox, newId, nowIso, rowOf } from './common';

export const DEFAULT_LOCATION_NAME = 'Sucursal Principal';
export const DEFAULT_PRICE_LIST_NAME = 'Público';
export const DEFAULT_REGISTER_NAME = 'Caja Principal';

/** Datos mínimos de un negocio nuevo (los mismos que trae una cuenta nueva de Pulpos): sucursal, lista "Público" y "Caja Principal". */
export function ensureBaseData(tx: Tx) {
  const at = nowIso();
  if (!tx.get('SELECT id FROM locations LIMIT 1')) {
    const id = newId();
    tx.run('INSERT INTO locations (id, name, is_default, created_at, updated_at) VALUES (?, ?, 1, ?, ?)', [id, DEFAULT_LOCATION_NAME, at, at]);
    enqueueOutbox(tx, 'location', id, 'upsert', rowOf(tx, 'locations', id));
  }
  if (!tx.get('SELECT id FROM price_lists WHERE deleted_at IS NULL LIMIT 1')) {
    const id = newId();
    tx.run('INSERT INTO price_lists (id, name, position, created_at, updated_at) VALUES (?, ?, 0, ?, ?)', [id, DEFAULT_PRICE_LIST_NAME, at, at]);
    enqueueOutbox(tx, 'price_list', id, 'upsert', rowOf(tx, 'price_lists', id));
  }
  if (!tx.get('SELECT id FROM cash_registers LIMIT 1')) {
    const id = newId();
    tx.run('INSERT INTO cash_registers (id, name, is_default, created_at, updated_at) VALUES (?, ?, 1, ?, ?)', [id, DEFAULT_REGISTER_NAME, at, at]);
    enqueueOutbox(tx, 'cash_register', id, 'upsert', rowOf(tx, 'cash_registers', id));
  }
}

export function defaultLocationId(tx: Tx) {
  const row = tx.get<{ id: string }>('SELECT id FROM locations ORDER BY is_default DESC, created_at LIMIT 1');
  if (!row) throw new Error('No hay ubicaciones configuradas');
  return row.id;
}

export function defaultRegisterId(tx: Tx) {
  const row = tx.get<{ id: string }>('SELECT id FROM cash_registers ORDER BY is_default DESC, created_at LIMIT 1');
  if (!row) throw new Error('No hay cajas configuradas');
  return row.id;
}
