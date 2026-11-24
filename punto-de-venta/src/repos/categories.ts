import type { Tx } from '@/db/database';
import { enqueueOutbox, newId, nowIso, rowOf, translateConstraint, trimOrNull, ValidationError } from './common';

export interface Category {
  id: string;
  name: string;
  image: string | null;
  product_count: number;
}

export interface CategoryInput {
  name: string;
  image?: string | null;
}

export function listCategories(tx: Tx): Category[] {
  return tx.all<Category>(
    `SELECT c.id, c.name, c.image,
       (SELECT count(*) FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS product_count
     FROM categories c WHERE c.deleted_at IS NULL ORDER BY c.name COLLATE NOCASE`,
  );
}

function validName(name: string) {
  const n = trimOrNull(name);
  if (!n) throw new ValidationError('Indica el nombre de la categoría', 'name');
  return n;
}

export function createCategory(tx: Tx, input: CategoryInput) {
  const id = newId();
  const at = nowIso();
  try {
    tx.run('INSERT INTO categories (id, name, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, validName(input.name), input.image ?? null, at, at]);
  } catch (err) {
    translateConstraint(err);
  }
  enqueueOutbox(tx, 'category', id, 'upsert', rowOf(tx, 'categories', id));
  return id;
}

export function updateCategory(tx: Tx, id: string, input: CategoryInput) {
  try {
    tx.run('UPDATE categories SET name = ?, image = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [validName(input.name), input.image ?? null, nowIso(), id]);
  } catch (err) {
    translateConstraint(err);
  }
  enqueueOutbox(tx, 'category', id, 'upsert', rowOf(tx, 'categories', id));
}

/** Borrado lógico; sus productos quedan "Sin Categoría" (y se sincroniza ese cambio en cada producto). */
export function deleteCategory(tx: Tx, id: string) {
  const at = nowIso();
  const affected = tx.all<{ id: string }>('SELECT id FROM products WHERE category_id = ? AND deleted_at IS NULL', [id]);
  tx.run('UPDATE products SET category_id = NULL, updated_at = ? WHERE category_id = ?', [at, id]);
  for (const p of affected) enqueueOutbox(tx, 'product', p.id, 'upsert', rowOf(tx, 'products', p.id));
  tx.run('UPDATE categories SET deleted_at = ?, updated_at = ? WHERE id = ?', [at, at, id]);
  enqueueOutbox(tx, 'category', id, 'delete', rowOf(tx, 'categories', id));
  return affected.length;
}

export interface Brand {
  id: string;
  name: string;
}

export function listBrands(tx: Tx): Brand[] {
  return tx.all<Brand>('SELECT id, name FROM brands WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE');
}

export function createBrand(tx: Tx, name: string) {
  const n = trimOrNull(name);
  if (!n) throw new ValidationError('Indica el nombre de la marca', 'brand');
  const id = newId();
  const at = nowIso();
  try {
    tx.run('INSERT INTO brands (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [id, n, at, at]);
  } catch (err) {
    translateConstraint(err);
  }
  enqueueOutbox(tx, 'brand', id, 'upsert', rowOf(tx, 'brands', id));
  return id;
}

export interface PriceList {
  id: string;
  name: string;
  position: number;
}

export function listPriceLists(tx: Tx): PriceList[] {
  return tx.all<PriceList>('SELECT id, name, position FROM price_lists WHERE deleted_at IS NULL ORDER BY position, created_at');
}

export function createPriceList(tx: Tx, name: string) {
  const n = trimOrNull(name);
  if (!n) throw new ValidationError('Indica el nombre de la lista de precios', 'name');
  const id = newId();
  const at = nowIso();
  const pos = (tx.get<{ p: number }>('SELECT coalesce(max(position), -1) + 1 AS p FROM price_lists')?.p ?? 0) as number;
  try {
    tx.run('INSERT INTO price_lists (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, n, pos, at, at]);
  } catch (err) {
    translateConstraint(err);
  }
  enqueueOutbox(tx, 'price_list', id, 'upsert', rowOf(tx, 'price_lists', id));
  return id;
}
