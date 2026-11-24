import type { Database } from '@/db/database';
import { getConnection } from '@/db/connection';
import { getSql } from '@/db/client';
import { validateBackup } from '@/server/core';

/**
 * Respaldo local (D31). Con Servidor POS el respaldo es la base del servidor (y el servidor hace uno automático al
 * día en su carpeta "respaldos"). Sin servidor, es la base de este navegador.
 */
const LOCAL_KEY = 'pos.lastBackup';
const DAY = 86_400_000;

const stamp = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

function saveFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const isServer = () => getConnection().mode === 'server';

export interface BackupStatus {
  lastDownload: string | null;
  lastAutoBackup: string | null;
}

export async function backupStatus(): Promise<BackupStatus> {
  if (isServer()) {
    const r = await fetch('./api/info', { cache: 'no-store' });
    const info = await r.json();
    return { lastDownload: info.lastDownload ?? null, lastAutoBackup: info.lastAutoBackup ?? null };
  }
  let last: string | null = null;
  try {
    last = localStorage.getItem(LOCAL_KEY);
  } catch {
    /* sin almacenamiento */
  }
  return { lastDownload: last, lastAutoBackup: null };
}

/** "Descargar Respaldo": un archivo .sqlite con todos los datos. */
export async function downloadBackup(db: Database) {
  if (isServer()) {
    const r = await fetch('./api/backup', { cache: 'no-store' });
    if (!r.ok) throw new Error('El servidor no pudo generar el respaldo');
    const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? `respaldo-pos-${stamp()}.sqlite`;
    saveFile(name, await r.blob());
    return name;
  }
  const bytes = await db.export();
  const name = `respaldo-pos-${stamp()}.sqlite`;
  saveFile(name, new Blob([bytes.slice().buffer], { type: 'application/vnd.sqlite3' }));
  try {
    localStorage.setItem(LOCAL_KEY, new Date().toISOString());
  } catch {
    /* sin almacenamiento */
  }
  return name;
}

/** Revisa un archivo antes de restaurarlo (devuelve cuántas ventas, productos y clientes trae). */
export async function inspectBackup(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const SQL = await getSql();
  validateBackup(SQL, bytes);
  const db = new SQL.Database(bytes);
  try {
    const n = (t: string) => Number(db.exec(`SELECT count(*) FROM ${t} WHERE deleted_at IS NULL`)[0]?.values[0][0] ?? 0);
    const last = db.exec('SELECT max(created_at) FROM sales')[0]?.values[0][0] as string | null;
    return { bytes, sales: n('sales'), products: n('products'), clients: n('clients'), lastSale: last ?? null };
  } finally {
    db.close();
  }
}

/** "Restaurar Respaldo": sustituye todos los datos. Con servidor, todas las PCs recargan solas. */
export async function restoreBackup(db: Database, bytes: Uint8Array) {
  if (isServer()) {
    const r = await fetch('./api/restore', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes.slice().buffer });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error ?? 'El servidor no pudo restaurar el respaldo');
    return body as { previous: string };
  }
  // Sin servidor se guarda antes una copia de lo que hay, por si se eligió el archivo equivocado.
  const current = await db.export();
  saveFile(`antes-de-restaurar-${stamp()}.sqlite`, new Blob([current.slice().buffer], { type: 'application/vnd.sqlite3' }));
  await db.replace(bytes);
  return { previous: 'descargado' };
}

export interface ServerBackup {
  name: string;
  size: number;
  created_at: string;
}
export async function listServerBackups(): Promise<ServerBackup[]> {
  if (!isServer()) return [];
  const r = await fetch('./api/backups', { cache: 'no-store' });
  return r.ok ? r.json() : [];
}

/** ¿Toca recordar? Hay ventas y hace más de 24 h (o nunca) que se descargó un respaldo. */
export function backupDue(lastDownload: string | null, hasSales: boolean, now = Date.now()) {
  if (!hasSales) return false;
  return !lastDownload || now - new Date(lastDownload).getTime() > DAY;
}
