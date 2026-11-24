// @vitest-environment node
import { createTestDb } from '@/db/test-db';
import type { Database } from '@/db/database';
import { cashSuggestions, lineTotals, saleTotals } from '@/domain/sale';
import { createPriceList, listPriceLists } from './categories';
import { createClient, DEFAULT_CREDIT_LIMIT_KEY, deleteClients, getClient, listClients, patchClient } from './clients';
import { createProduct } from './products';
import { addSaleComment, BLOCK_OVERDUE_KEY, clientRecentSales, createSale, deleteSale, deliverSale, getSale, listSales, posFindByCode, posSearch, salesReportRows, setSaleClient, type SaleInput } from './sales';
import { setSetting } from './settings';

let db: Database;
let publico: string;
let cemento: string;
let tornillo: string;
let servicio: string;

const stock = (id: string) => db.read((t) => t.get<{ q: number }>('SELECT quantity q FROM stock_levels WHERE product_id = ?', [id])!.q);
const count = (sql: string) => db.read((t) => t.get<{ n: number }>(sql)!.n);
const sale = (over: Partial<SaleInput> = {}): SaleInput => ({
  id: crypto.randomUUID(),
  lines: [{ productId: cemento, quantity: 2, unitPriceCents: 22000, priceListId: publico }],
  payment: { method: 'cash', receivedCents: 50000 },
  ...over,
});

beforeEach(async () => {
  db = await createTestDb();
  publico = (await db.read(listPriceLists))[0].id;
  [cemento, tornillo, servicio] = await db.write((tx) => [
    createProduct(tx, { type: 'product', name: 'Cemento gris 25 kg', sku: 'CEM-25', barcode: '7501000000011', initialStock: 10, costCents: 18000, prices: { [publico]: 22000 } }),
    createProduct(tx, { type: 'product', name: 'Tornillo 1"', sku: 'TOR-1', unit: 'kg', initialStock: 1, prices: { [publico]: 4500 } }),
    createProduct(tx, { type: 'service', name: 'Instalación eléctrica', sku: 'SERV-ELE', prices: { [publico]: 25000 } }),
  ]);
});

describe('cálculo del carrito', () => {
  it('descuento por monto o porcentaje, nunca mayor que el renglón', () => {
    expect(lineTotals({ quantity: 2, unitPriceCents: 1000, taxRate: 0.16, discount: { type: 'amount', value: 500 } })).toMatchObject({ grossCents: 2000, discountCents: 500, totalCents: 1500, taxCents: 207 });
    expect(lineTotals({ quantity: 1, unitPriceCents: 1000, taxRate: 0, discount: { type: 'percent', value: 15 } }).totalCents).toBe(850);
    expect(lineTotals({ quantity: 1, unitPriceCents: 1000, taxRate: 0, discount: { type: 'amount', value: 5000 } }).totalCents).toBe(0);
    expect(lineTotals({ quantity: 0.5, unitPriceCents: 4500, taxRate: 0 }).totalCents).toBe(2250);
  });

  it('quitar impuestos cobra el precio sin IVA', () => {
    const t = saleTotals([{ quantity: 1, unitPriceCents: 11600, taxRate: 0.16 }], true);
    expect(t).toMatchObject({ grossCents: 11600, taxesRemovedCents: 1600, totalCents: 10000, taxCents: 0 });
  });

  it('billetes sugeridos', () => {
    expect(cashSuggestions(23750)).toEqual([23750, 25000, 30000, 40000]);
    expect(cashSuggestions(50000)).toEqual([50000, 60000, 100000]);
  });
});

describe('registrar venta', () => {
  it('en efectivo: encabezado, renglones, pago, caja, inventario e historial en una transacción', async () => {
    const r = await db.write((tx) => createSale(tx, sale()));
    expect(r).toMatchObject({ folio: 1, changeCents: 6000, duplicate: false });
    expect(await stock(cemento)).toBe(8);
    const s = (await db.read((t) => getSale(t, r.id)))!;
    expect(s).toMatchObject({ total_cents: 44000, paid_cents: 44000, balance_cents: 0, received_cents: 50000, change_cents: 6000, delivery_status: 'delivered', register_name: 'Caja Principal' });
    expect(s.items[0]).toMatchObject({ name: 'Cemento gris 25 kg', quantity: 2, total_cents: 44000, tax_cents: 6069 });
    expect(s.events.map((e) => e.title)).toEqual(['Entrega de Productos', 'Cobro de $440.00 en Efectivo', 'Venta Registrada']);
    const mov = await db.read((t) => t.get<{ description: string; quantity: number }>("SELECT description, quantity FROM inventory_movements WHERE reason = 'sale_delivery'"));
    expect(mov).toEqual({ description: 'Entrega de Venta #1', quantity: -2 });
    expect(await db.read((t) => t.all("SELECT type, method, amount_cents FROM cash_movements"))).toEqual([{ type: 'sale', method: 'cash', amount_cents: 44000 }]);
  });

  it('es idempotente: cobrar dos veces el mismo carrito no duplica la venta ni el stock', async () => {
    const input = sale();
    await db.write((tx) => createSale(tx, input));
    const again = await db.write((tx) => createSale(tx, input));
    expect(again.duplicate).toBe(true);
    expect(await count('SELECT count(*) n FROM sales')).toBe(1);
    expect(await count('SELECT count(*) n FROM cash_movements')).toBe(1);
    expect(await stock(cemento)).toBe(8);
  });

  it('si algo falla no queda nada a medias (rollback)', async () => {
    const bad = sale({ lines: [{ productId: cemento, quantity: 1, unitPriceCents: 22000 }, { productId: 'no-existe', quantity: 1, unitPriceCents: 100 }] });
    await expect(db.write((tx) => createSale(tx, bad))).rejects.toThrow('ya no existe');
    expect(await count('SELECT count(*) n FROM sales')).toBe(0);
    expect(await count('SELECT count(*) n FROM sale_items')).toBe(0);
    expect(await stock(cemento)).toBe(10);
  });

  it('permite stock negativo (D3), no mueve stock de servicios ni de entradas manuales', async () => {
    await db.write((tx) =>
      createSale(tx, sale({
        lines: [
          { productId: tornillo, quantity: 2.5, unitPriceCents: 4500 },
          { productId: servicio, quantity: 1, unitPriceCents: 25000 },
          { name: 'Corte de varilla', quantity: 3, unitPriceCents: 1000, chargeTaxes: false },
        ],
        payment: { method: 'debit_card' },
      })),
    );
    expect(await stock(tornillo)).toBe(-1.5);
    expect(await count("SELECT count(*) n FROM inventory_movements WHERE reason = 'sale_delivery'")).toBe(1);
    const s = (await db.read((t) => t.get<{ total_cents: number; tax_cents: number }>('SELECT total_cents, tax_cents FROM sales')))!;
    expect(s.total_cents).toBe(11250 + 25000 + 3000);
    expect(await db.read((t) => t.all('SELECT method, amount_cents FROM cash_movements'))).toEqual([{ method: 'debit_card', amount_cents: 39250 }]);
  });

  it('valida carrito vacío, cantidades y efectivo insuficiente', async () => {
    await expect(db.write((tx) => createSale(tx, sale({ lines: [] })))).rejects.toThrow('vacío');
    await expect(db.write((tx) => createSale(tx, sale({ lines: [{ productId: cemento, quantity: 0, unitPriceCents: 1 }] })))).rejects.toThrow('mayor a 0');
    await expect(db.write((tx) => createSale(tx, sale({ payment: { method: 'cash', receivedCents: 100 } })))).rejects.toThrow('no cubre');
  });

  it('los folios son consecutivos', async () => {
    for (let i = 0; i < 3; i++) await db.write((tx) => createSale(tx, sale()));
    expect(await db.read((t) => t.all<{ folio: number }>('SELECT folio FROM sales ORDER BY folio').map((r) => r.folio))).toEqual([1, 2, 3]);
  });
});

describe('crédito', () => {
  let ana: string;
  beforeEach(async () => {
    ana = await db.write((tx) => createClient(tx, { firstName: 'Ana', lastName: 'Ruiz' }));
  });

  it('requiere cliente, genera deuda con vencimiento a 15 días y no mueve caja', async () => {
    await expect(db.write((tx) => createSale(tx, sale({ payment: { method: 'credit' } })))).rejects.toThrow('asigna un cliente');
    const r = await db.write((tx) => createSale(tx, sale({ clientId: ana, payment: { method: 'credit' }, createdAt: '2026-11-21T15:00:00.000Z' })));
    const s = (await db.read((t) => getSale(t, r.id)))!;
    expect(s).toMatchObject({ balance_cents: 44000, credit_cents: 44000, due_date: '2026-12-06T15:00:00.000Z' });
    expect(s.events.map((e) => e.title)).toContain('Asignación de $440.00 de Crédito');
    expect(await count('SELECT count(*) n FROM cash_movements')).toBe(0);
    const c = (await db.read((t) => getClient(t, ana)))!;
    expect(c).toMatchObject({ sales_count: 1, debt_cents: 44000, total_sold_cents: 44000 });
    expect((await db.read((t) => listClients(t))).rows[0].debt_cents).toBe(44000);
    expect(await db.read((t) => clientRecentSales(t, ana))).toHaveLength(1);
    await expect(db.write((tx) => deleteClients(tx, [ana]))).rejects.toThrow('deuda pendiente');
  });

  it('respeta el límite de crédito (personalizado o predeterminado)', async () => {
    await db.write((tx) => patchClient(tx, ana, { creditLimitCents: 50000 }));
    await db.write((tx) => createSale(tx, sale({ clientId: ana, payment: { method: 'credit' } })));
    await expect(db.write((tx) => createSale(tx, sale({ clientId: ana, payment: { method: 'credit' } })))).rejects.toThrow('Disponible: $60.00');
    await db.write((tx) => patchClient(tx, ana, { creditLimitCents: null }));
    await db.write((tx) => setSetting(tx, DEFAULT_CREDIT_LIMIT_KEY, 10000));
    await expect(db.write((tx) => createSale(tx, sale({ clientId: ana, payment: { method: 'credit' } })))).rejects.toThrow('límite de crédito');
  });

  it('puede bloquear el crédito a clientes con deuda vencida', async () => {
    await db.write((tx) => createSale(tx, sale({ clientId: ana, payment: { method: 'credit' }, createdAt: '2026-01-01T00:00:00.000Z' })));
    await db.write((tx) => createSale(tx, sale({ clientId: ana, payment: { method: 'credit' } })));
    await db.write((tx) => setSetting(tx, BLOCK_OVERDUE_KEY, true));
    await expect(db.write((tx) => createSale(tx, sale({ clientId: ana, payment: { method: 'credit' } })))).rejects.toThrow('deuda vencida');
  });

  it('no se puede quitar el cliente de una venta a crédito', async () => {
    const r = await db.write((tx) => createSale(tx, sale({ clientId: ana, payment: { method: 'credit' } })));
    await expect(db.write((tx) => setSaleClient(tx, r.id, null))).rejects.toThrow('no se puede cambiar');
  });
});

describe('entrega posterior y eliminación', () => {
  it('apartado: el stock baja hasta entregar, una sola vez', async () => {
    const r = await db.write((tx) => createSale(tx, sale({ deferDelivery: true })));
    expect(await stock(cemento)).toBe(10);
    expect((await db.read((t) => getSale(t, r.id)))!.events[0].title).toBe('Apartado de Productos');
    expect(await db.write((tx) => deliverSale(tx, r.id))).toBe(true);
    expect(await db.write((tx) => deliverSale(tx, r.id))).toBe(false);
    expect(await stock(cemento)).toBe(8);
  });

  it('los pedidos se registran sin entregar', async () => {
    const r = await db.write((tx) => createSale(tx, sale({ mode: 'order' })));
    const s = (await db.read((t) => getSale(t, r.id)))!;
    expect(s.delivery_status).toBe('pending');
    expect(s.events.at(-1)!.title).toBe('Pedido Registrado');
  });

  it('eliminar regresa el stock y descuenta la caja, sin borrar el historial', async () => {
    const r = await db.write((tx) => createSale(tx, sale()));
    await db.write((tx) => deleteSale(tx, r.id));
    expect(await stock(cemento)).toBe(10);
    expect(await db.read((t) => t.all("SELECT description, quantity FROM inventory_movements WHERE reason = 'sale_deletion'"))).toEqual([{ description: 'Eliminación de Venta #1', quantity: 2 }]);
    expect(await db.read((t) => t.get<{ s: number }>('SELECT sum(amount_cents) s FROM cash_movements')!.s)).toBe(0);
    expect(await count('SELECT count(*) n FROM sale_items')).toBe(1);
    expect((await db.read((t) => listSales(t))).total).toBe(0);
    await expect(db.write((tx) => deleteSale(tx, r.id))).rejects.toThrow('eliminada');
    await expect(db.write((tx) => tx.run('DELETE FROM cash_movements'))).rejects.toThrow('no se pueden eliminar');
  });

  it('eliminar un apartado no regresa stock que nunca salió', async () => {
    const r = await db.write((tx) => createSale(tx, sale({ deferDelivery: true })));
    await db.write((tx) => deleteSale(tx, r.id));
    expect(await stock(cemento)).toBe(10);
  });
});

describe('historial de ventas', () => {
  it('pestañas, búsqueda por folio, cliente o producto, filtros y CSV', async () => {
    const ana = await db.write((tx) => createClient(tx, { firstName: 'Ana', lastName: 'Ruiz' }));
    await db.write((tx) => createSale(tx, sale()));
    await db.write((tx) => createSale(tx, sale({ clientId: ana, payment: { method: 'credit' }, deferDelivery: true })));
    await db.write((tx) => createSale(tx, sale({ lines: [{ productId: tornillo, quantity: 1, unitPriceCents: 4500, discount: { type: 'amount', value: 500 } }], payment: { method: 'transfer' } })));
    const folios = async (q: Parameters<typeof listSales>[1]) => (await db.read((t) => listSales(t, q))).rows.map((r) => r.folio);
    const all = await db.read((t) => listSales(t));
    expect(all.rows.map((r) => r.folio)).toEqual([3, 2, 1]);
    expect(all.counts).toEqual({ pending: 1, undelivered: 1 });
    expect(await folios({ tab: 'pending_payment' })).toEqual([2]);
    expect(await folios({ tab: 'undelivered' })).toEqual([2]);
    expect(await folios({ q: 'N1' })).toEqual([1]);
    expect(await folios({ q: 'ruiz' })).toEqual([2]);
    expect(await folios({ q: 'tornillo' })).toEqual([3]);
    expect(await folios({ filters: { method: 'transfer' } })).toEqual([3]);
    expect(await folios({ filters: { discount: 'with' } })).toEqual([3]);
    expect(await folios({ filters: { payment: 'paid' }, sort: 'total-asc' })).toEqual([3, 1]);
    expect(await folios({ filters: { from: '2999-01-01' } })).toEqual([]);
    const report = await db.read((t) => salesReportRows(t, { from: '2000-01-01T00:00:00.000Z', to: '2999-01-01T00:00:00.000Z' }));
    expect(report).toHaveLength(3);
    expect(report[1]).toEqual(['N2', 'Ana Ruiz', 'Deuda pendiente', 440, 440]);
    expect(report[0]).toEqual(['N3', 'Público General', 'Pagada', expect.any(Number), 0]);
    expect(await db.read((t) => salesReportRows(t, { from: '2999-01-01T00:00:00.000Z', to: '2999-01-02T00:00:00.000Z' }))).toEqual([]);
  });

  it('comentarios en el historial', async () => {
    const r = await db.write((tx) => createSale(tx, sale()));
    await db.write((tx) => addSaleComment(tx, r.id, 'Pasa por la factura el lunes'));
    expect((await db.read((t) => getSale(t, r.id)))!.events[0]).toMatchObject({ type: 'comment', title: 'Pasa por la factura el lunes' });
  });
});

describe('búsqueda del punto de venta', () => {
  it('por nombre o SKU, código de barras exacto primero, y precio de la lista elegida', async () => {
    const mayoreo = await db.write((tx) => createPriceList(tx, 'Mayoreo'));
    await db.write((tx) => tx.run('INSERT INTO product_prices (product_id, price_list_id, price_cents, updated_at) VALUES (?, ?, 20000, ?)', [cemento, mayoreo, new Date().toISOString()]));
    expect((await db.read((t) => posSearch(t, 'cemento', publico)))[0]).toMatchObject({ name: 'Cemento gris 25 kg', price_cents: 22000, stock: 10 });
    expect((await db.read((t) => posSearch(t, 'cemento', mayoreo)))[0]).toMatchObject({ price_cents: 20000, price_list_id: mayoreo });
    // Sin precio en Mayoreo: usa el de Público.
    expect((await db.read((t) => posSearch(t, 'tornillo', mayoreo)))[0]).toMatchObject({ price_cents: 4500, price_list_id: publico });
    expect((await db.read((t) => posFindByCode(t, '7501000000011', publico)))!.name).toBe('Cemento gris 25 kg');
    expect((await db.read((t) => posFindByCode(t, 'tor-1', publico)))!.name).toBe('Tornillo 1"');
    expect(await db.read((t) => posFindByCode(t, '000', publico))).toBeNull();
  });
});

describe('vencimiento', () => {
  it('texto relativo por días de calendario', async () => {
    const { dueText } = await import('@/domain/sale');
    const now = new Date(2026, 10, 21, 18, 0);
    expect(dueText(new Date(2026, 11, 6, 9, 0).toISOString(), now)).toBe('Vence en 15 días');
    expect(dueText(new Date(2026, 10, 22, 1, 0).toISOString(), now)).toBe('Vence mañana');
    expect(dueText(new Date(2026, 10, 21, 8, 0).toISOString(), now)).toBe('Vence hoy');
    expect(dueText(new Date(2026, 10, 15, 8, 0).toISOString(), now)).toBe('Venció hace 6 días');
  });
});
