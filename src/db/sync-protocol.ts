import type { SqlValue } from 'sql.js';

/**
 * Protocolo entre las PCs y el Servidor POS (D30). El servidor guarda la base; cada PC tiene una copia para leer.
 * Una escritura viaja como la lista de sentencias que produjo la transacción en la PC, con la versión sobre la que
 * se calculó. El servidor solo la aplica si sigue en esa versión; si no, devuelve lo que falta y la PC reintenta.
 * Es determinista porque ids y fechas se calculan en la app y viajan como parámetros.
 */

export type WireValue = number | string | null | { $b: string };
export interface Statement {
  sql: string;
  params?: WireValue[] | Record<string, WireValue>;
}
export interface Change {
  version: number;
  statements: Statement[];
}

export interface ServerInfo {
  pos: true;
  epoch: string;
  version: number;
  schema: number;
  /** Fecha del último respaldo manual descargado (ISO) y del último automático. */
  lastDownload: string | null;
  lastAutoBackup: string | null;
  /** Acceso (D33). Sin sesión, el servidor solo manda `pos`, `schema` y `auth`. */
  auth?: AuthInfo;
  /** Direcciones del servidor en la red local, para abrir el POS en las demás PCs. */
  urls?: string[];
  /** Dirección de la Oficina Virtual cuando el POS corre dentro de ella (D37). */
  home?: string;
}

export interface AuthInfo {
  /** ¿Ya existe al menos un usuario? */
  configured: boolean;
  /** Usuario de la sesión de esta ventana, o null. */
  user: string | null;
  /** Sin usuarios y abierto desde la propia PC servidor: se puede crear el primero. */
  canSetup: boolean;
}

export type CommitResponse = { ok: true; version: number } | { ok: false; reason: 'conflict'; changes: Change[]; version: number } | { ok: false; reason: 'reset' };
export type ChangesResponse = { reset: false; version: number; changes: Change[] } | { reset: true };

const toB64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function encodeValue(v: SqlValue): WireValue {
  return v instanceof Uint8Array ? { $b: toB64(v) } : (v as WireValue);
}
export function decodeValue(v: WireValue): SqlValue {
  return v !== null && typeof v === 'object' ? fromB64(v.$b) : v;
}

export function encodeParams(p: SqlValue[] | Record<string, SqlValue> | undefined): Statement['params'] {
  if (!p) return undefined;
  if (Array.isArray(p)) return p.map(encodeValue);
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, encodeValue(v)]));
}
export function decodeParams(p: Statement['params']): SqlValue[] | Record<string, SqlValue> | undefined {
  if (!p) return undefined;
  if (Array.isArray(p)) return p.map(decodeValue);
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, decodeValue(v)]));
}

/**
 * Solo se aceptan INSERT, UPDATE y DELETE de una sola sentencia: una PC de la red no puede cambiar el esquema,
 * adjuntar archivos ni apagar las llaves foráneas. Los triggers de la base siguen protegiendo lo inmutable.
 */
export function isAllowedStatement(sql: string) {
  const s = sql.trim().replace(/;\s*$/, '');
  if (!/^(INSERT|UPDATE|DELETE)\b/i.test(s)) return false;
  // Sin una segunda sentencia: no se permite ';' fuera de las cadenas.
  return !s.replace(/'(?:[^']|'')*'/g, "''").includes(';');
}
