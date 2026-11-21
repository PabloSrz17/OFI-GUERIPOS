// @vitest-environment node
import { createTestDb, openTestDb } from '@/db/test-db';
import type { Database } from '@/db/database';
import { createCategory, deleteCategory, listCategories, listPriceLists, updateCategory } from './categories';
import { createProduct, deleteProducts, getProduct, listProducts, productsCsv, updateProduct } from './products';
import { applyMovement } from './inventory';
import { defaultLocationId } from './bootstrap';
import { ValidationError } from './common';
import { costWithTaxesCents, margin, normalizeSearch, taxRate } from '@/domain/catalog';

let db: Database;
let publico: string;

beforeEach(async () => {
  db = await createTestDb();
  publico = (await db.read(listPriceLists))[0].id;
});

const count = (table: string, where = '1') => db.read((q) => q.get<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)!.n);

describe('datos base', () => {
  it('crea la sucursal principal y la lista Público una sola vez', async () => {
    expect(await count('locations')).toBe(1);
    expect((await db.read(listPriceLists)).map((l) => l.name)).toEqual(['Público']);
  });
});

describe('alta de producto', () => {
  it('es atómica: producto, precio, existencias, movimiento "Stock inicial" y outbox', async () => {
    const id = await db.write((tx) => createProduct(tx, { type: 'product', name: 'Jabón de mano', initialStock: 5, prices: { [publico]: 1200 }, costCents: 700 }));
    const p = (await db.read((q) => getProduct(q, id)))!;
    expect(p.name).toBe('Jabón de mano');
    expect(p.prices[0]).toMatchObject({ name: 'Público', price_cents: 1200 });
    expect(p.stock[0]).toMatchObject({ location_name: 'Sucursal Principal', quantity: 5 });
    expect(p.movements).toHaveLength(1);
    expect(p.movements[0]).toMatchObject({ description: 'Stock inicial', quantity: 5, stock_before: 0, stock_after: 5, reason: 'initial' });
    expect(await count('outbox', "entity = 'product'")).toBe(1);
    expect(await count('outbox', "entity = 'inventory_movement'")).toBe(1);
  });

  it('sin existencias iniciales no crea movimiento', async () => {
    const id = await db.write((tx) => createProduct(tx, { type: 'product', name: 'Sin stock' }));
    expect((await db.read((q) => getProduct(q, id)))!.movements).toHaveLength(0);
  });

  it('si algo falla no queda nada a medias (rollback)', async () => {
    await expect(
      db.write((tx) => createProduct(tx, { type: 'product', name: 'Malo', initialStock: 3, prices: { [publico]: -5 } })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await count('products')).toBe(0);
    expect(await count('inventory_movements')).toBe(0);
    expect(await count('outbox', "entity <> 'location' AND entity <> 'cash_register' AND entity <> 'price_list'")).toBe(0);
  });

  it('exige nombre y rechaza SKU o código de barras repetidos', async () => {
    await expect(db.write((tx) => createProduct(tx, { type: 'product', name: '  ' }))).rejects.toThrow('Indica el nombre del producto');
    await db.write((tx) => createProduct(tx, { type: 'product', name: 'A', sku: 'X1', barcode: '750100' }));
    await expect(db.write((tx) => createProduct(tx, { type: 'product', name: 'B', sku: 'x1' }))).rejects.toThrow('Ya existe un producto con este SKU');
    await expect(db.write((tx) => createProduct(tx, { type: 'product', name: 'C', barcode: '750100' }))).rejects.toThrow('código de barras');
  });

  it('crea la categoría al vuelo ("Buscar o crear categoría") y reutiliza la existente', async () => {
    await db.write((tx) => createProduct(tx, { type: 'product', name: 'A', newCategoryName: 'Plomería' }));
    await db.write((tx) => createProduct(tx, { type: 'product', name: 'B', newCategoryName: 'plomería' }));
    const cats = await db.read(listCategories);
    expect(cats).toHaveLength(1);
    expect(cats[0]).toMatchObject({ name: 'Plomería', product_count: 2 });
  });

  it('los servicios no llevan existencias ni movimientos', async () => {
    const id = await db.write((tx) => createProduct(tx, { type: 'service', name: 'Instalación', initialStock: 4 }));
    const p = (await db.read((q) => getProduct(q, id)))!;
    expect(p.track_stock).toBe(0);
    expect(p.movements).toHaveLength(0);
  });
});

describe('regla: el stock nunca cambia sin movimiento', () => {
  it('la base rechaza modificar stock_levels directamente', async () => {
    const id = await db.write((tx) => createProduct(tx, { type: 'product', name: 'A', initialStock: 2 }));
    await expect(db.write((tx) => tx.run('UPDATE stock_levels SET quantity = 99 WHERE product_id = ?', [id]))).rejects.toThrow('sin un movimiento');
    await expect(db.write((tx) => tx.run('INSERT INTO stock_levels (product_id, location_id, quantity, updated_at) VALUES (?, ?, 3, ?)', [id, 'x', '']))).rejects.toThrow();
  });

  it('los movimientos son inmutables', async () => {
    await db.write((tx) => createProduct(tx, { type: 'product', name: 'A', initialStock: 2 }));
    await expect(db.write((tx) => tx.run('UPDATE inventory_movements SET quantity = 5'))).rejects.toThrow('no se pueden modificar');
    await expect(db.write((tx) => tx.run('DELETE FROM inventory_movements'))).rejects.toThrow('no se pueden eliminar');
  });

  it('applyMovement encadena stock anterior y nuevo y permite negativos', async () => {
    const id = await db.write((tx) => createProduct(tx, { type: 'product', name: 'A', initialStock: 1 }));
    await db.write((tx) => applyMovement(tx, { productId: id, locationId: defaultLocationId(tx), quantity: -3, reason: 'adjustment', description: 'Ajuste' }));
    const p = (await db.read((q) => getProduct(q, id)))!;
    expect(p.stock[0].quantity).toBe(-2);
    expect(p.movements[0]).toMatchObject({ stock_before: 1, stock_after: -2, quantity: -3 });
  });

  it('editar un producto no cambia sus existencias', async () => {
    const id = await db.write((tx) => createProduct(tx, { type: 'product', name: 'A', initialStock: 7 }));
    await db.write((tx) => updateProduct(tx, id, { type: 'product', name: 'A2', initialStock: 100, minStock: 2 }));
    const p = (await db.read((q) => getProduct(q, id)))!;
    expect(p.name).toBe('A2');
    expect(p.stock[0]).toMatchObject({ quantity: 7, min_quantity: 2 });
  });
});

describe('lista de productos', () => {
  beforeEach(async () => {
    await db.write((tx) => {
      createProduct(tx, { type: 'product', name: 'Jabón de mano', sku: 'JAB-1', barcode: '7501', newCategoryName: 'Limpieza', initialStock: 3, minStock: 5, prices: { [publico]: 2500 } });
      createProduct(tx, { type: 'product', name: 'Cloro 1 L', sku: 'CLO-1', newCategoryName: 'Limpieza', initialStock: 0, prices: { [publico]: 1800 } });
      createProduct(tx, { type: 'product', name: 'Arroz 1 kg', sku: 'ARR', initialStock: -2, prices: { [publico]: 3000 } });
      createProduct(tx, { type: 'service', name: 'Envío a domicilio', sellInPos: false });
    });
  });

  it('busca por nombre sin acentos, SKU y código de barras', async () => {
    expect((await db.read((q) => listProducts(q, { q: 'jabon' }))).rows.map((r) => r.name)).toEqual(['Jabón de mano']);
    expect((await db.read((q) => listProducts(q, { q: 'clo-1' }))).rows.map((r) => r.name)).toEqual(['Cloro 1 L']);
    expect((await db.read((q) => listProducts(q, { q: '7501' }))).total).toBe(1);
    expect((await db.read((q) => listProducts(q, { q: '100%' }))).total).toBe(0);
  });

  it('ordena como Pulpos', async () => {
    const names = async (sort: Parameters<typeof listProducts>[1] extends infer Q ? Q extends { sort?: infer S } ? S : never : never) =>
      (await db.read((q) => listProducts(q, { sort }))).rows.map((r) => r.name);
    expect(await names('name-asc')).toEqual(['Arroz 1 kg', 'Cloro 1 L', 'Envío a domicilio', 'Jabón de mano']);
    expect((await names('stock-asc')).slice(0, 3)).toEqual(['Arroz 1 kg', 'Cloro 1 L', 'Jabón de mano']);
    expect((await names('category-asc')).slice(0, 2)).toEqual(['Cloro 1 L', 'Jabón de mano']);
  });

  it('filtra por tipo, existencias, reposición, código y punto de venta', async () => {
    const total = async (filters: object) => (await db.read((q) => listProducts(q, { filters }))).total;
    expect(await total({ type: 'service' })).toBe(1);
    expect(await total({ stock: 'in_stock' })).toBe(1);
    expect(await total({ stock: 'out_of_stock' })).toBe(2);
    expect(await total({ stock: 'reorder' })).toBe(1);
    expect(await total({ barcode: 'with' })).toBe(1);
    expect(await total({ pos: 'hidden' })).toBe(1);
    expect(await total({ categoryId: 'none' })).toBe(2);
  });

  it('pagina de 25 en 25 y ajusta la página fuera de rango', async () => {
    const r = await db.read((q) => listProducts(q, { pageSize: 3, page: 9 }));
    expect(r).toMatchObject({ total: 4, totalPages: 2, page: 2 });
    expect(r.rows).toHaveLength(1);
  });

  it('el borrado es lógico y libera el SKU', async () => {
    const [jabon] = (await db.read((q) => listProducts(q, { q: 'jabon' }))).rows;
    await db.write((tx) => deleteProducts(tx, [jabon.id]));
    expect((await db.read((q) => listProducts(q))).total).toBe(3);
    expect(await count('inventory_movements', `product_id = '${jabon.id}'`)).toBe(1);
    await db.write((tx) => createProduct(tx, { type: 'product', name: 'Jabón nuevo', sku: 'JAB-1' }));
  });

  it('exporta CSV con comillas cuando hace falta', async () => {
    const csv = await db.read(productsCsv);
    expect(csv.split('\r\n')[0]).toBe('Nombre,SKU,Código de barras,Tipo,Categoría,Marca,Unidad,Precio,Costo,Existencias');
    expect(csv).toContain('Jabón de mano,JAB-1,7501,Producto,Limpieza,,unit,25.00,0.00,3');
  });
});

describe('categorías', () => {
  it('crea, renombra y elimina dejando los productos "Sin Categoría"', async () => {
    const cat = await db.write((tx) => createCategory(tx, { name: 'Aderezos' }));
    await expect(db.write((tx) => createCategory(tx, { name: 'aderezos' }))).rejects.toThrow('Ya existe una categoría');
    const pid = await db.write((tx) => createProduct(tx, { type: 'product', name: 'Mayonesa', categoryId: cat }));
    await db.write((tx) => updateCategory(tx, cat, { name: 'Salsas' }));
    expect((await db.read(listCategories))[0]).toMatchObject({ name: 'Salsas', product_count: 1 });
    await db.write((tx) => deleteCategory(tx, cat));
    expect(await db.read(listCategories)).toHaveLength(0);
    expect((await db.read((q) => getProduct(q, pid)))!.category_id).toBeNull();
    // Se puede volver a crear una categoría con el nombre de una eliminada.
    await db.write((tx) => createCategory(tx, { name: 'Salsas' }));
  });
});

describe('persistencia', () => {
  it('cada transacción confirmada se persiste y sobrevive a reabrir la base', async () => {
    let saved: Uint8Array | null = null;
    const pdb = await createTestDb(async (b) => {
      saved = b;
    });
    await pdb.write((tx) => createProduct(tx, { type: 'product', name: 'Persistente', initialStock: 2 }));
    const reopened = await openTestDb(saved!);
    expect((await reopened.read((q) => listProducts(q))).rows[0]).toMatchObject({ name: 'Persistente', stock: 2 });
    // Las llaves foráneas siguen activas después de exportar.
    await expect(pdb.write((tx) => tx.run("INSERT INTO product_prices (product_id, price_list_id, price_cents, updated_at) VALUES ('no', 'no', 1, '')"))).rejects.toThrow('FOREIGN KEY');
  });

  it('si falla la persistencia, la operación se reporta como fallida', async () => {
    const pdb = await createTestDb(async () => {
      throw new Error('disco lleno');
    }).catch(() => null);
    expect(pdb).toBeNull();
  });
});

describe('reglas de precio', () => {
  it('margen sobre el precio, como en Pulpos', () => {
    expect(margin(1200, 0)).toEqual({ profitCents: 1200, ratio: 1 });
    expect(margin(0, 0)).toEqual({ profitCents: 0, ratio: 0 });
    expect(margin(1000, 750).ratio).toBeCloseTo(0.25);
  });
  it('impuestos combinados y costo bruto', () => {
    expect(taxRate({ chargeTaxes: true, iva: '16', ieps: 'none' })).toBeCloseTo(0.16);
    expect(taxRate({ chargeTaxes: true, iva: '16', ieps: '8' })).toBeCloseTo(0.2528);
    expect(taxRate({ chargeTaxes: false, iva: '16', ieps: '8' })).toBe(0);
    expect(costWithTaxesCents(1000, 'bruto', 0.16)).toBe(1160);
    expect(costWithTaxesCents(1000, 'neto', 0.16)).toBe(1000);
  });
  it('normaliza texto de búsqueda', () => {
    expect(normalizeSearch('  Jabón   DE Mano ')).toBe('jabon de mano');
  });
});
