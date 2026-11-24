import type { Params, Tx } from '@/db/database';
import { normalizeSearch, type CostMode } from '@/domain/catalog';
import { enqueueOutbox, newId, nowIso, rowOf, translateConstraint, trimOrNull, ValidationError } from './common';
import { defaultLocationId } from './bootstrap';
import { createBrand, createCategory } from './categories';
import { applyMovement, ensureStockLevel, recentMovements, type Movement } from './inventory';

export type ProductType = 'product' | 'service';

export interface ProductInput {
  type: ProductType;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  description?: string | null;
  categoryId?: string | null;
  /** Nombre de categoría nueva a crear en la misma transacción (combobox "Buscar o crear"). */
  newCategoryName?: string | null;
  brandId?: string | null;
  newBrandName?: string | null;
  unit?: string;
  shelfLocation?: string | null;
  sellInPos?: boolean;
  requiresPrescription?: boolean;
  trackStock?: boolean;
  /** Solo al crear: existencias iniciales (se registran como movimiento "Stock inicial"). */
  initialStock?: number;
  minStock?: number;
  costCents?: number;
  costMode?: CostMode;
  chargeTaxes?: boolean;
  iva?: string;
  ieps?: string;
  satKey?: string | null;
  image?: string | null;
  /** price_list_id → centavos (con impuestos incluidos). */
  prices?: Record<string, number>;
}

export interface ProductRow {
  id: string;
  type: ProductType;
  name: string;
  sku: string | null;
  barcode: string | null;
  image: string | null;
  unit: string;
  track_stock: number;
  category_name: string | null;
  price_cents: number | null;
  stock: number | null;
  min_stock: number | null;
}

export type ProductSort =
  | 'name-asc' | 'name-desc'
  | 'sku-asc' | 'sku-desc'
  | 'category-asc' | 'category-desc'
  | 'stock-asc' | 'stock-desc'
  | 'created-asc' | 'created-desc';

export interface ProductFilters {
  categoryId?: string | 'none';
  brandId?: string;
  type?: ProductType;
  barcode?: 'with' | 'without';
  pos?: 'visible' | 'hidden';
  prescription?: 'required' | 'not_required';
  stock?: 'in_stock' | 'out_of_stock' | 'reorder';
}

export interface ProductQuery {
  q?: string;
  sort?: ProductSort;
  filters?: ProductFilters;
  page?: number;
  pageSize?: number;
}

const SORT_SQL: Record<ProductSort, string> = {
  'name-asc': 'p.name COLLATE NOCASE ASC',
  'name-desc': 'p.name COLLATE NOCASE DESC',
  'sku-asc': "p.sku IS NULL, p.sku COLLATE NOCASE ASC",
  'sku-desc': "p.sku IS NULL, p.sku COLLATE NOCASE DESC",
  'category-asc': 'c.name IS NULL, c.name COLLATE NOCASE ASC',
  'category-desc': 'c.name IS NULL, c.name COLLATE NOCASE DESC',
  'stock-asc': 'p.track_stock = 0, stock ASC',
  'stock-desc': 'p.track_stock = 0, stock DESC',
  'created-asc': 'p.created_at ASC',
  'created-desc': 'p.created_at DESC',
};

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function searchTextOf(p: { name: string; sku?: string | null; barcode?: string | null }) {
  return normalizeSearch([p.name, p.sku, p.barcode].filter(Boolean).join(' '));
}

/** Lista paginada con búsqueda (nombre, SKU, código de barras; sin acentos), filtros y orden de Pulpos. */
export function listProducts(tx: Tx, query: ProductQuery = {}) {
  const { q = '', sort = 'name-asc', filters = {}, page = 1, pageSize = 25 } = query;
  const where: string[] = ['p.deleted_at IS NULL'];
  const params: Record<string, string | number> = {};

  normalizeSearch(q)
    .split(' ')
    .filter(Boolean)
    .forEach((term, i) => {
      where.push(`p.search_text LIKE :t${i} ESCAPE '\\'`);
      params[`t${i}`] = `%${escapeLike(term)}%`;
    });

  if (filters.categoryId === 'none') where.push('p.category_id IS NULL');
  else if (filters.categoryId) {
    where.push('p.category_id = :categoryId');
    params.categoryId = filters.categoryId;
  }
  if (filters.brandId) {
    where.push('p.brand_id = :brandId');
    params.brandId = filters.brandId;
  }
  if (filters.type) {
    where.push('p.type = :type');
    params.type = filters.type;
  }
  if (filters.barcode === 'with') where.push('p.barcode IS NOT NULL');
  if (filters.barcode === 'without') where.push('p.barcode IS NULL');
  if (filters.pos === 'visible') where.push('p.sell_in_pos = 1');
  if (filters.pos === 'hidden') where.push('p.sell_in_pos = 0');
  if (filters.prescription === 'required') where.push('p.requires_prescription = 1');
  if (filters.prescription === 'not_required') where.push('p.requires_prescription = 0');
  if (filters.stock === 'in_stock') where.push('p.track_stock = 1 AND coalesce(s.quantity, 0) > 0');
  if (filters.stock === 'out_of_stock') where.push('p.track_stock = 1 AND coalesce(s.quantity, 0) <= 0');
  if (filters.stock === 'reorder') where.push('p.track_stock = 1 AND coalesce(s.min_quantity, 0) > 0 AND coalesce(s.quantity, 0) <= s.min_quantity');

  const from = `FROM products p
    LEFT JOIN categories c ON c.id = p.category_id AND c.deleted_at IS NULL
    LEFT JOIN (SELECT product_id, sum(quantity) AS quantity, sum(min_quantity) AS min_quantity FROM stock_levels GROUP BY product_id) s ON s.product_id = p.id
    WHERE ${where.join(' AND ')}`;

  const total = tx.get<{ n: number }>(`SELECT count(*) AS n ${from}`, params)!.n;
  const size = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), totalPages);
  const rows = tx.all<ProductRow>(
    `SELECT p.id, p.type, p.name, p.sku, p.barcode, p.image, p.unit, p.track_stock,
       c.name AS category_name,
       (SELECT pp.price_cents FROM product_prices pp JOIN price_lists pl ON pl.id = pp.price_list_id
         WHERE pp.product_id = p.id AND pl.deleted_at IS NULL ORDER BY pl.position LIMIT 1) AS price_cents,
       coalesce(s.quantity, 0) AS stock, coalesce(s.min_quantity, 0) AS min_stock
     ${from} ORDER BY ${SORT_SQL[sort] ?? SORT_SQL['name-asc']}, p.name COLLATE NOCASE, p.id LIMIT :limit OFFSET :offset`,
    { ...params, limit: size, offset: (current - 1) * size },
  );
  return { rows, total, page: current, totalPages };
}

export interface ProductDetail {
  id: string;
  type: ProductType;
  name: string;
  sku: string | null;
  barcode: string | null;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  brand_id: string | null;
  brand_name: string | null;
  unit: string;
  shelf_location: string | null;
  sell_in_pos: number;
  requires_prescription: number;
  track_stock: number;
  cost_cents: number;
  cost_mode: CostMode;
  charge_taxes: number;
  iva: string;
  ieps: string;
  sat_key: string | null;
  image: string | null;
  created_at: string;
  updated_at: string;
  prices: { price_list_id: string; name: string; price_cents: number | null }[];
  stock: { location_id: string; location_name: string; quantity: number; min_quantity: number }[];
  movements: Movement[];
}

export function getProduct(tx: Tx, id: string): ProductDetail | null {
  const p = tx.get<Omit<ProductDetail, 'prices' | 'stock' | 'movements'>>(
    `SELECT p.*, c.name AS category_name, b.name AS brand_name FROM products p
     LEFT JOIN categories c ON c.id = p.category_id AND c.deleted_at IS NULL
     LEFT JOIN brands b ON b.id = p.brand_id AND b.deleted_at IS NULL
     WHERE p.id = ? AND p.deleted_at IS NULL`,
    [id],
  );
  if (!p) return null;
  const prices = tx.all<ProductDetail['prices'][number]>(
    `SELECT pl.id AS price_list_id, pl.name, pp.price_cents FROM price_lists pl
     LEFT JOIN product_prices pp ON pp.price_list_id = pl.id AND pp.product_id = ?
     WHERE pl.deleted_at IS NULL ORDER BY pl.position, pl.created_at`,
    [id],
  );
  const stock = tx.all<ProductDetail['stock'][number]>(
    `SELECT l.id AS location_id, l.name AS location_name, coalesce(s.quantity, 0) AS quantity, coalesce(s.min_quantity, 0) AS min_quantity
     FROM locations l LEFT JOIN stock_levels s ON s.location_id = l.id AND s.product_id = ?
     ORDER BY l.is_default DESC, l.name`,
    [id],
  );
  return { ...p, prices, stock, movements: recentMovements(tx, id) };
}

function resolveRefs(tx: Tx, input: ProductInput) {
  let categoryId = input.categoryId ?? null;
  if (!categoryId && trimOrNull(input.newCategoryName)) {
    const existing = tx.get<{ id: string }>('SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL', [input.newCategoryName!.trim()]);
    categoryId = existing?.id ?? createCategory(tx, { name: input.newCategoryName! });
  }
  let brandId = input.brandId ?? null;
  if (!brandId && trimOrNull(input.newBrandName)) {
    const existing = tx.get<{ id: string }>('SELECT id FROM brands WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL', [input.newBrandName!.trim()]);
    brandId = existing?.id ?? createBrand(tx, input.newBrandName!);
  }
  return { categoryId, brandId };
}

function columns(input: ProductInput, refs: { categoryId: string | null; brandId: string | null }) {
  const name = trimOrNull(input.name);
  if (!name) throw new ValidationError('Indica el nombre del producto', 'name');
  const isService = input.type === 'service';
  const sku = trimOrNull(input.sku);
  const barcode = trimOrNull(input.barcode);
  const cost = Math.round(input.costCents ?? 0);
  if (cost < 0) throw new ValidationError('El costo no puede ser negativo', 'cost');
  return {
    type: input.type,
    name,
    sku,
    barcode,
    description: trimOrNull(input.description),
    category_id: refs.categoryId,
    brand_id: refs.brandId,
    unit: input.unit ?? 'unit',
    shelf_location: trimOrNull(input.shelfLocation),
    sell_in_pos: input.sellInPos ?? true,
    requires_prescription: input.requiresPrescription ?? false,
    // Los servicios no llevan existencias.
    track_stock: isService ? false : (input.trackStock ?? true),
    cost_cents: cost,
    cost_mode: input.costMode ?? 'neto',
    charge_taxes: input.chargeTaxes ?? true,
    iva: input.iva ?? '16',
    ieps: input.ieps ?? 'none',
    sat_key: trimOrNull(input.satKey),
    image: input.image ?? null,
    search_text: searchTextOf({ name, sku, barcode }),
  };
}

function savePrices(tx: Tx, productId: string, prices: Record<string, number> | undefined, at: string) {
  if (!prices) return;
  for (const [listId, cents] of Object.entries(prices)) {
    const c = Math.round(cents);
    if (!Number.isFinite(c) || c < 0) throw new ValidationError('El precio no puede ser negativo', 'price');
    tx.run(
      `INSERT INTO product_prices (product_id, price_list_id, price_cents, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (product_id, price_list_id) DO UPDATE SET price_cents = excluded.price_cents, updated_at = excluded.updated_at`,
      [productId, listId, c, at],
    );
  }
}

/** Payload completo del producto para la sincronización (fila + precios + existencias). */
function productPayload(tx: Tx, id: string) {
  return {
    ...rowOf(tx, 'products', id),
    prices: tx.all('SELECT price_list_id, price_cents FROM product_prices WHERE product_id = ?', [id]),
    stock_levels: tx.all('SELECT location_id, quantity, min_quantity FROM stock_levels WHERE product_id = ?', [id]),
  };
}

/**
 * Alta atómica: producto, precios, existencias por ubicación, movimiento "Stock inicial" (si hay cantidad)
 * y eventos de sincronización. Si algo falla, no queda nada a medias.
 */
export function createProduct(tx: Tx, input: ProductInput) {
  const id = newId();
  const at = nowIso();
  const refs = resolveRefs(tx, input);
  const cols = columns(input, refs);
  const keys = Object.keys(cols);
  try {
    tx.run(
      `INSERT INTO products (id, ${keys.join(', ')}, created_at, updated_at) VALUES (:id, ${keys.map((k) => `:${k}`).join(', ')}, :at, :at)`,
      { id, ...cols, at } as Params,
    );
  } catch (err) {
    translateConstraint(err);
  }
  savePrices(tx, id, input.prices, at);
  if (cols.track_stock) {
    const locationId = defaultLocationId(tx);
    ensureStockLevel(tx, id, locationId, Math.max(0, input.minStock ?? 0));
    const qty = input.initialStock ?? 0;
    if (!Number.isFinite(qty)) throw new ValidationError('Cantidad inválida', 'stock');
    if (qty !== 0) applyMovement(tx, { productId: id, locationId, quantity: qty, reason: 'initial', description: 'Stock inicial', createdAt: at });
  }
  enqueueOutbox(tx, 'product', id, 'upsert', productPayload(tx, id));
  return id;
}

/** Edición: no toca la cantidad en existencia (eso solo ocurre con movimientos: ajustes, ventas…). */
export function updateProduct(tx: Tx, id: string, input: ProductInput) {
  const current = tx.get<{ id: string }>('SELECT id FROM products WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!current) throw new ValidationError('El producto ya no existe');
  const at = nowIso();
  const refs = resolveRefs(tx, input);
  const cols = columns(input, refs);
  try {
    tx.run(`UPDATE products SET ${Object.keys(cols).map((k) => `${k} = :${k}`).join(', ')}, updated_at = :at WHERE id = :id`, { id, ...cols, at } as Params);
  } catch (err) {
    translateConstraint(err);
  }
  savePrices(tx, id, input.prices, at);
  if (cols.track_stock) {
    const locationId = defaultLocationId(tx);
    ensureStockLevel(tx, id, locationId);
    if (input.minStock !== undefined) {
      tx.run('UPDATE stock_levels SET min_quantity = ?, updated_at = ? WHERE product_id = ? AND location_id = ?', [Math.max(0, input.minStock), at, id, locationId]);
    }
  }
  enqueueOutbox(tx, 'product', id, 'upsert', productPayload(tx, id));
}

/** Borrado lógico: el historial (movimientos, ventas) se conserva y los SKU/códigos quedan libres. */
export function deleteProducts(tx: Tx, ids: string[]) {
  const at = nowIso();
  let n = 0;
  for (const id of ids) {
    const exists = tx.get('SELECT id FROM products WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!exists) continue;
    tx.run('UPDATE products SET deleted_at = ?, updated_at = ? WHERE id = ?', [at, at, id]);
    enqueueOutbox(tx, 'product', id, 'delete', productPayload(tx, id));
    n++;
  }
  return n;
}

/** Exportación CSV ("Descargar Productos"). */
export function productsCsv(tx: Tx) {
  const rows = tx.all<Record<string, string | number | null>>(
    `SELECT p.name, p.sku, p.barcode, CASE p.type WHEN 'service' THEN 'Servicio' ELSE 'Producto' END AS type,
       c.name AS category, b.name AS brand, p.unit,
       (SELECT pp.price_cents FROM product_prices pp JOIN price_lists pl ON pl.id = pp.price_list_id WHERE pp.product_id = p.id AND pl.deleted_at IS NULL ORDER BY pl.position LIMIT 1) AS price_cents,
       p.cost_cents, CASE WHEN p.track_stock = 1 THEN (SELECT coalesce(sum(quantity), 0) FROM stock_levels WHERE product_id = p.id) END AS stock
     FROM products p LEFT JOIN categories c ON c.id = p.category_id AND c.deleted_at IS NULL LEFT JOIN brands b ON b.id = p.brand_id AND b.deleted_at IS NULL
     WHERE p.deleted_at IS NULL ORDER BY p.name COLLATE NOCASE`,
  );
  const header = ['Nombre', 'SKU', 'Código de barras', 'Tipo', 'Categoría', 'Marca', 'Unidad', 'Precio', 'Costo', 'Existencias'];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [r.name, r.sku, r.barcode, r.type, r.category, r.brand, r.unit, r.price_cents === null ? '' : (Number(r.price_cents) / 100).toFixed(2), (Number(r.cost_cents) / 100).toFixed(2), r.stock].map(esc).join(','),
  );
  return [header.join(','), ...lines].join('\r\n');
}
