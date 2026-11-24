import type { Params, Tx } from '@/db/database';
import { normalizeSearch } from '@/domain/catalog';
import { balanceSql, enqueueOutbox, newId, nowIso, rowOf, trimOrNull, ValidationError } from './common';
import { getSetting } from './settings';

export { getSetting, setSetting } from './settings';

export interface ClientAddress {
  street?: string | null;
  ext?: string | null;
  int?: string | null;
  zip?: string | null;
  neighborhood?: string | null;
  municipality?: string | null;
  city?: string | null;
  state?: string | null;
}

export interface ClientInput {
  firstName: string;
  lastName?: string | null;
  phoneCountry?: string;
  phone?: string | null;
  email?: string | null;
  priceListId?: string | null;
  comments?: string | null;
  address?: ClientAddress | null;
}

export interface ClientRow {
  id: string;
  first_name: string;
  last_name: string | null;
  phone_country: string;
  phone: string | null;
  email: string | null;
  sales_count: number;
  debt_cents: number;
}

export interface ClientDetail extends ClientRow {
  price_list_id: string | null;
  price_list_name: string | null;
  credit_limit_cents: number | null;
  comments: string | null;
  address_street: string | null;
  address_ext: string | null;
  address_int: string | null;
  address_zip: string | null;
  address_neighborhood: string | null;
  address_municipality: string | null;
  address_city: string | null;
  address_state: string | null;
  total_sold_cents: number;
  created_at: string;
}

export type ClientSort = 'name-asc' | 'name-desc' | 'created-asc' | 'created-desc';

export type ClientDebtFilter = 'none' | 'overdue' | 'current';

export interface ClientQuery {
  q?: string;
  sort?: ClientSort;
  priceListId?: string;
  /** "Estado de Deuda" (J-clients-filter.png): sin deuda, con deuda vencida, o con deuda y nada vencido (D26). */
  debt?: ClientDebtFilter;
  page?: number;
  pageSize?: number;
}

export function clientName(c: { first_name: string; last_name?: string | null }) {
  return [c.first_name, c.last_name].filter(Boolean).join(' ');
}

/** "+529811052126", como en la lista de Pulpos. */
export function clientPhone(c: { phone_country: string; phone: string | null }) {
  return c.phone ? `${c.phone_country}${c.phone}` : '';
}

/** "Calle 5 #12 Int. 3, Centro, CP 24000, Campeche, Campeche" (vacío si no hay dirección). */
export function formatAddress(c: Pick<ClientDetail, 'address_street' | 'address_ext' | 'address_int' | 'address_zip' | 'address_neighborhood' | 'address_municipality' | 'address_city' | 'address_state'>) {
  const street = [c.address_street, c.address_ext && `#${c.address_ext}`, c.address_int && `Int. ${c.address_int}`].filter(Boolean).join(' ');
  const city = c.address_city && c.address_municipality && c.address_city === c.address_municipality ? c.address_city : [c.address_municipality, c.address_city].filter(Boolean).join(', ');
  return [street, c.address_neighborhood, c.address_zip && `CP ${c.address_zip}`, city, c.address_state].filter(Boolean).join(', ');
}

const SORT_SQL: Record<ClientSort, string> = {
  'name-asc': 'c.first_name COLLATE NOCASE ASC, c.last_name COLLATE NOCASE ASC',
  'name-desc': 'c.first_name COLLATE NOCASE DESC, c.last_name COLLATE NOCASE DESC',
  'created-asc': 'c.created_at ASC',
  'created-desc': 'c.created_at DESC',
};

// Estadísticas de ventas vigentes (no eliminadas) del cliente.
const STATS_SQL = `(SELECT count(*) FROM sales s WHERE s.client_id = c.id AND s.deleted_at IS NULL) AS sales_count,
  (SELECT coalesce(sum(${balanceSql('s')}), 0) FROM sales s WHERE s.client_id = c.id AND s.deleted_at IS NULL) AS debt_cents`;

/** Lista paginada: búsqueda por nombre, teléfono o email (sin acentos), orden y filtro por lista de precios. */
export function listClients(tx: Tx, query: ClientQuery = {}) {
  const { q = '', sort = 'name-asc', priceListId, debt, page = 1, pageSize = 25 } = query;
  const where = ['c.deleted_at IS NULL'];
  const params: Record<string, string | number> = {};
  normalizeSearch(q)
    .split(' ')
    .filter(Boolean)
    .forEach((term, i) => {
      where.push(`c.search_text LIKE :t${i} ESCAPE '\\'`);
      params[`t${i}`] = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    });
  if (priceListId) {
    where.push('c.price_list_id = :priceListId');
    params.priceListId = priceListId;
  }
  if (debt) {
    const d0 = new Date();
    params.today = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).toISOString();
    const has = `EXISTS (SELECT 1 FROM sales s WHERE s.client_id = c.id AND s.deleted_at IS NULL AND ${balanceSql('s')} > 0`;
    const overdue = `${has} AND s.due_date < :today)`;
    where.push(debt === 'none' ? `NOT ${has})` : debt === 'overdue' ? overdue : `${has}) AND NOT ${overdue}`);
  }
  const from = `FROM clients c WHERE ${where.join(' AND ')}`;
  const total = tx.get<{ n: number }>(`SELECT count(*) AS n ${from}`, params)!.n;
  const size = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), totalPages);
  const rows = tx.all<ClientRow>(
    `SELECT c.id, c.first_name, c.last_name, c.phone_country, c.phone, c.email, ${STATS_SQL}
     ${from} ORDER BY ${SORT_SQL[sort] ?? SORT_SQL['name-asc']}, c.id LIMIT :limit OFFSET :offset`,
    { ...params, limit: size, offset: (current - 1) * size },
  );
  return { rows, total, page: current, totalPages };
}

export function getClient(tx: Tx, id: string): ClientDetail | null {
  return (
    tx.get<ClientDetail>(
      `SELECT c.*, pl.name AS price_list_name, ${STATS_SQL},
              (SELECT coalesce(sum(s.total_cents), 0) FROM sales s WHERE s.client_id = c.id AND s.deleted_at IS NULL) AS total_sold_cents
       FROM clients c LEFT JOIN price_lists pl ON pl.id = c.price_list_id AND pl.deleted_at IS NULL
       WHERE c.id = ? AND c.deleted_at IS NULL`,
      [id],
    ) ?? null
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function columns(input: ClientInput) {
  const first = trimOrNull(input.firstName);
  if (!first) throw new ValidationError('Indica el nombre del cliente', 'firstName');
  const email = trimOrNull(input.email);
  if (email && !EMAIL_RE.test(email)) throw new ValidationError('El email no es válido', 'email');
  const phone = trimOrNull(input.phone)?.replace(/[\s\-().]/g, '') ?? null;
  if (phone && !/^\d{7,15}$/.test(phone)) throw new ValidationError('El teléfono debe tener solo números (7 a 15 dígitos)', 'phone');
  const last = trimOrNull(input.lastName);
  const a = input.address ?? {};
  return {
    first_name: first,
    last_name: last,
    phone_country: input.phoneCountry ?? '+52',
    phone,
    email,
    price_list_id: input.priceListId ?? null,
    comments: trimOrNull(input.comments),
    address_street: trimOrNull(a.street),
    address_ext: trimOrNull(a.ext),
    address_int: trimOrNull(a.int),
    address_zip: trimOrNull(a.zip),
    address_neighborhood: trimOrNull(a.neighborhood),
    address_municipality: trimOrNull(a.municipality),
    address_city: trimOrNull(a.city),
    address_state: trimOrNull(a.state),
    search_text: normalizeSearch([first, last, phone, email].filter(Boolean).join(' ')),
  };
}

export function createClient(tx: Tx, input: ClientInput) {
  const id = newId();
  const at = nowIso();
  const cols = columns(input);
  const keys = Object.keys(cols);
  tx.run(`INSERT INTO clients (id, ${keys.join(', ')}, created_at, updated_at) VALUES (:id, ${keys.map((k) => `:${k}`).join(', ')}, :at, :at)`, { id, ...cols, at } as Params);
  enqueueOutbox(tx, 'client', id, 'upsert', rowOf(tx, 'clients', id));
  return id;
}

export function updateClient(tx: Tx, id: string, input: ClientInput) {
  if (!tx.get('SELECT id FROM clients WHERE id = ? AND deleted_at IS NULL', [id])) throw new ValidationError('El cliente ya no existe');
  const cols = columns(input);
  tx.run(`UPDATE clients SET ${Object.keys(cols).map((k) => `${k} = :${k}`).join(', ')}, updated_at = :at WHERE id = :id`, { id, ...cols, at: nowIso() } as Params);
  enqueueOutbox(tx, 'client', id, 'upsert', rowOf(tx, 'clients', id));
}

/** Cambios puntuales desde las tarjetas del detalle (lista de precios, límite de crédito, comentarios). */
export function patchClient(tx: Tx, id: string, patch: { priceListId?: string | null; creditLimitCents?: number | null; comments?: string | null }) {
  const sets: string[] = [];
  const params: Record<string, string | number | null> = { id, at: nowIso() };
  if ('priceListId' in patch) {
    sets.push('price_list_id = :pl');
    params.pl = patch.priceListId ?? null;
  }
  if ('creditLimitCents' in patch) {
    const v = patch.creditLimitCents;
    if (v !== null && v !== undefined && (!Number.isFinite(v) || v < 0)) throw new ValidationError('El límite debe ser un monto positivo', 'creditLimit');
    sets.push('credit_limit_cents = :cl');
    params.cl = v === undefined || v === null ? null : Math.round(v);
  }
  if ('comments' in patch) {
    sets.push('comments = :cm');
    params.cm = trimOrNull(patch.comments);
  }
  if (!sets.length) return;
  tx.run(`UPDATE clients SET ${sets.join(', ')}, updated_at = :at WHERE id = :id AND deleted_at IS NULL`, params);
  enqueueOutbox(tx, 'client', id, 'upsert', rowOf(tx, 'clients', id));
}

/** Borrado lógico. No se puede eliminar un cliente con deuda pendiente (su deuda quedaría sin dueño). */
export function deleteClients(tx: Tx, ids: string[]) {
  const at = nowIso();
  let n = 0;
  for (const id of ids) {
    const c = tx.get<{ first_name: string; last_name: string | null }>('SELECT first_name, last_name FROM clients WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!c) continue;
    const debt = tx.get<{ d: number }>(`SELECT coalesce(sum(${balanceSql('s')}), 0) AS d FROM sales s WHERE s.client_id = ? AND s.deleted_at IS NULL`, [id])!.d;
    if (debt > 0) throw new ValidationError(`${clientName(c)} tiene una deuda pendiente; no se puede eliminar`);
    tx.run('UPDATE clients SET deleted_at = ?, updated_at = ? WHERE id = ?', [at, at, id]);
    enqueueOutbox(tx, 'client', id, 'delete', rowOf(tx, 'clients', id));
    n++;
  }
  return n;
}

export function clientsCsv(tx: Tx) {
  const rows = tx.all<ClientDetail>(
    `SELECT c.*, pl.name AS price_list_name FROM clients c LEFT JOIN price_lists pl ON pl.id = c.price_list_id
     WHERE c.deleted_at IS NULL ORDER BY c.first_name COLLATE NOCASE, c.last_name COLLATE NOCASE`,
  );
  const header = ['Nombre', 'Apellido', 'Teléfono', 'Email', 'Lista de Precios', 'Dirección', 'Comentarios'];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.join(','), ...rows.map((r) => [r.first_name, r.last_name, clientPhone(r), r.email, r.price_list_name, formatAddress(r), r.comments].map(esc).join(','))].join('\r\n');
}

// ---------- Preferencias ----------

export const DEFAULT_CREDIT_LIMIT_KEY = 'clients.default_credit_limit_cents';

/** Límite de crédito que aplica: el del cliente o el predeterminado; null = sin limitar. */
export function effectiveCreditLimit(tx: Tx, client: { credit_limit_cents: number | null }) {
  return client.credit_limit_cents ?? getSetting<number | null>(tx, DEFAULT_CREDIT_LIMIT_KEY, null);
}
