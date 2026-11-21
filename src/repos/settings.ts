import type { Tx } from '@/db/database';
import { enqueueOutbox, nowIso } from './common';

/** Preferencias del negocio guardadas como JSON (tabla settings). */
export function getSetting<T>(tx: Tx, key: string, fallback: T): T {
  const row = tx.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function setSetting(tx: Tx, key: string, value: unknown) {
  const at = nowIso();
  tx.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', [key, JSON.stringify(value), at]);
  enqueueOutbox(tx, 'setting', key, 'upsert', { key, value, updated_at: at });
}
