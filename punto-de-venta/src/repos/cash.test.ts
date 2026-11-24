// @vitest-environment node
import { createTestDb, openTestDb } from '@/db/test-db';
import type { Database } from '@/db/database';
import { LATEST_VERSION } from '@/db/migrations';
import { listPriceLists } from './categories';
import { createClient } from './clients';
import { createProduct } from './products';
import { createSale, deleteSale, type SaleInput } from './sales';
import { addCashFlow, createCut, currentCash, cutsCsv, getCut, listCuts, periodMovements, voidCashFlow } from './cash';

let db: Database;
let publico: string;
let cemento: string;

const sale = (over: Partial<SaleInput> = {}): SaleInput => ({
  id: crypto.randomUUID(),
  lines: [{ productId: cemento, quantity: 1, unitPriceCents: 22000, priceListId: publico }],
  payment: { method: 'cash', receivedCents: 22000 },
  ...over,
});
const expected = async () => Object.fromEntries((await db.read(currentCash)).breakdown.map((b) => [b.method, b.expected]));

beforeEach(async () => {
  db = await createTestDb();
  publico = (await db.read(listPriceLists))[0].id;
  cemento = await db.write((tx) => createProduct(tx, { type: 'product', name: 'Cemento gris 25 kg', sku: 'CEM-25', initialStock: 50, prices: { [publico]: 22000 } }));
});

describe('caja actual', () => {
  it('el total esperado suma ventas, ingresos, retiros y eliminaciones por método', async () => {
    await db.write((tx) => createSale(tx, sale()));
    await db.write((tx) => createSale(tx, sale({ payment: { method: 'debit_card' } })));
    const transfer = await db.write((tx) => createSale(tx, sale({ payment: { method: 'transfer' } })));
    await db.write((tx) => addCashFlow(tx, { type: 'cash_in', amountCents: 50000, reason: 'Cambio' }));
    await db.write((tx) => addCashFlow(tx, { type: 'cash_out', amountCents: 12000, reason: 'Pago de luz' }));
    await db.write((tx) => deleteSale(tx, transfer.id));
    // Ventas a crédito no entran a la caja.
    const client = await db.write((tx) => createClient(tx, { firstName: 'Ana' }));
    await db.write((tx) => createSale(tx, sale({ clientId: client, payment: { method: 'credit' } })));

    expect(await expected()).toEqual({ cash: 22000 + 50000 - 12000, credit_card: 0, debit_card: 22000, transfer: 0 });
    const cash = (await db.read(currentCash)).breakdown[0];
    expect(cash).toMatchObject({ start: 0, sales: 22000, collections: 0, cashIn: 50000, cashOut: -12000, deletions: 0, expected: 60000 });
    const t = (await db.read(currentCash)).breakdown[3];
    expect(t).toMatchObject({ sales: 22000, deletions: -22000, expected: 0 });
    expect((await db.read(currentCash)).flows.map((f) => [f.type, f.amount_cents, f.description])).toEqual([
      ['cash_out', -12000, 'Pago de luz'],
      ['cash_in', 50000, 'Cambio'],
    ]);
  });

  it('ingreso o retiro: monto obligatorio, motivo por defecto e idempotencia', async () => {
    await expect(db.write((tx) => addCashFlow(tx, { type: 'cash_in', amountCents: 0 }))).rejects.toThrow('Ingresa un monto mayor a $0');
    const id = crypto.randomUUID();
    await db.write((tx) => addCashFlow(tx, { id, type: 'cash_out', amountCents: 5000, reason: '  ' }));
    expect((await db.write((tx) => addCashFlow(tx, { id, type: 'cash_out', amountCents: 5000 }))).duplicate).toBe(true);
    const flows = (await db.read(currentCash)).flows;
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({ description: 'Retiro de Efectivo', amount_cents: -5000, method: 'cash', user_name: 'Administrador' });
  });

  it('eliminar un ingreso agrega un movimiento que lo anula; nada se borra', async () => {
    const { id } = await db.write((tx) => addCashFlow(tx, { type: 'cash_in', amountCents: 30000, reason: 'Fondo' }));
    expect(await db.write((tx) => voidCashFlow(tx, id))).toBe(true);
    expect(await db.write((tx) => voidCashFlow(tx, id))).toBe(false);
    expect(await expected()).toMatchObject({ cash: 0 });
    expect((await db.read(currentCash)).flows).toHaveLength(0);
    const all = await db.read((tx) => periodMovements(tx, (currentCash(tx)).registerId));
    expect(all.map((m) => [m.type, m.amount_cents])).toEqual([
      ['cash_in_void', -30000],
      ['cash_in', 30000],
    ]);
    expect(all[0].description).toBe('Eliminación de Ingreso de $300.00: Fondo');
  });

  it('los movimientos de caja no se pueden borrar ni cambiar de corte', async () => {
    await db.write((tx) => createSale(tx, sale()));
    await expect(db.write((tx) => tx.run('DELETE FROM cash_movements'))).rejects.toThrow('no se pueden eliminar');
    await expect(db.write((tx) => tx.run('UPDATE cash_movements SET amount_cents = 1'))).rejects.toThrow('no se pueden modificar');
    const cut = await db.write((tx) => createCut(tx, { id: crypto.randomUUID(), counted: {} }));
    await expect(db.write((tx) => tx.run('UPDATE cash_movements SET cut_id = NULL'))).rejects.toThrow('no se pueden modificar');
    await expect(db.write((tx) => tx.run('DELETE FROM cash_cuts'))).rejects.toThrow('no se pueden eliminar');
    await expect(db.write((tx) => tx.run('UPDATE cash_cut_lines SET counted_cents = 0'))).rejects.toThrow('no se pueden modificar');
    expect(cut.folio).toBe(1);
  });
});

describe('corte de caja', () => {
  it('congela esperado y recuento por método, retira todo el efectivo y empieza un periodo nuevo', async () => {
    await db.write((tx) => createSale(tx, sale()));
    await db.write((tx) => createSale(tx, sale({ payment: { method: 'credit_card' } })));
    await db.write((tx) => addCashFlow(tx, { type: 'cash_out', amountCents: 2000, reason: 'Garrafón' }));
    const id = crypto.randomUUID();
    // Faltan $5 en efectivo; la tarjeta no se capturó (= lo esperado).
    const r = await db.write((tx) => createCut(tx, { id, counted: { cash: 19500 }, comments: 'Faltó cambio' }));
    expect(r).toEqual({ id, folio: 1, duplicate: false });

    const c = (await db.read((tx) => getCut(tx, id)))!;
    expect(c).toMatchObject({ expected_cents: 42000, counted_cents: 41500, difference_cents: -500, withdrawn_cents: 19500, remaining_cents: 0, start_cents: 0, comments: 'Faltó cambio', register_name: 'Caja Principal' });
    expect(c.lines).toEqual([
      { method: 'cash', expected_cents: 20000, counted_cents: 19500 },
      { method: 'credit_card', expected_cents: 22000, counted_cents: 22000 },
      { method: 'debit_card', expected_cents: 0, counted_cents: 0 },
      { method: 'transfer', expected_cents: 0, counted_cents: 0 },
    ]);
    expect(c.breakdown[0]).toMatchObject({ sales: 22000, cashOut: -2000, expected: 20000 });
    expect(c.flows.map((f) => f.description)).toEqual(['Garrafón']);

    // Periodo nuevo: vacío y sin fondo.
    const now = await db.read(currentCash);
    expect(now).toMatchObject({ total: 0, movementCount: 0, flows: [] });
    expect(now.breakdown[0].start).toBe(0);
    // Un retiro del corte anterior ya no se puede eliminar.
    await expect(db.write((tx) => voidCashFlow(tx, c.flows[0].id))).rejects.toThrow('ya está en un corte');
  });

  it('es idempotente, recalcula lo esperado y no deja cortar una caja sin movimientos', async () => {
    await expect(db.write((tx) => createCut(tx, { id: crypto.randomUUID(), counted: {} }))).rejects.toThrow('No hay movimientos desde el último corte');
    await db.write((tx) => createSale(tx, sale()));
    const id = crypto.randomUUID();
    await db.write((tx) => createCut(tx, { id, counted: { cash: 22000 } }));
    expect((await db.write((tx) => createCut(tx, { id, counted: { cash: 1 } }))).duplicate).toBe(true);
    await expect(db.write((tx) => addCashFlow(tx, { type: 'cash_in', amountCents: 100 }).id && createCut(tx, { id: crypto.randomUUID(), counted: { cash: -1 } }))).rejects.toThrow('negativo');
    // El rechazo deshizo también el ingreso: la caja sigue vacía.
    expect((await db.read(currentCash)).movementCount).toBe(0);
  });

  it('eliminar una venta de un corte cerrado descuenta en el periodo actual', async () => {
    const s = await db.write((tx) => createSale(tx, sale()));
    await db.write((tx) => createCut(tx, { id: crypto.randomUUID(), counted: {} }));
    await db.write((tx) => deleteSale(tx, s.id));
    expect((await db.read(currentCash)).breakdown[0]).toMatchObject({ deletions: -22000, expected: -22000 });
  });

  it('historial: orden, búsqueda, filtro por diferencia y CSV', async () => {
    for (const counted of [22000, 21000, 22000]) {
      await db.write((tx) => createSale(tx, sale()));
      await db.write((tx) => createCut(tx, { id: crypto.randomUUID(), counted: { cash: counted }, comments: counted < 22000 ? 'Faltante' : null }));
    }
    const all = await db.read((tx) => listCuts(tx));
    expect(all.rows.map((r) => r.folio)).toEqual([3, 2, 1]);
    expect((await db.read((tx) => listCuts(tx, { sort: 'created-asc' }))).rows[0].folio).toBe(1);
    expect((await db.read((tx) => listCuts(tx, { filters: { difference: 'with' } }))).rows.map((r) => [r.folio, r.difference_cents])).toEqual([[2, -1000]]);
    expect((await db.read((tx) => listCuts(tx, { filters: { difference: 'without' } }))).total).toBe(2);
    expect((await db.read((tx) => listCuts(tx, { q: 'faltan' }))).total).toBe(1);
    expect((await db.read((tx) => listCuts(tx, { q: 'principal' }))).total).toBe(3);
    const csv = await db.read((tx) => cutsCsv(tx));
    expect(csv.split('\n')[0]).toBe('Corte,Fecha,Caja,Realizado por,Total Esperado,Recuento,Diferencia,Retiro por corte,Comentarios');
    expect(csv).toContain(',220.00,210.00,-10.00,210.00,Faltante');
  });

  it('migra una base de la Etapa 5 sin perder los movimientos de caja', async () => {
    let bytes: Uint8Array | null = null;
    const pdb = await createTestDb(async (b) => {
      bytes = b;
    });
    const list = (await pdb.read(listPriceLists))[0].id;
    const p = await pdb.write((tx) => createProduct(tx, { type: 'product', name: 'X', sku: 'X-1', initialStock: 5, prices: { [list]: 1000 } }));
    await pdb.write((tx) => createSale(tx, { id: crypto.randomUUID(), lines: [{ productId: p, quantity: 1, unitPriceCents: 1000, priceListId: list }], payment: { method: 'cash', receivedCents: 1000 } }));
    // Deja la base como en la Etapa 5: tabla de movimientos v3 y sin cortes.
    await pdb.write((tx) => {
      tx.run('DELETE FROM schema_migrations WHERE version >= 4');
      tx.run('ALTER TABLE sales DROP COLUMN source');
      tx.run('ALTER TABLE sales DROP COLUMN delivery_method');
      tx.run('DROP INDEX payments_collection');
      tx.run('ALTER TABLE payments DROP COLUMN collection_id');
      tx.run('DROP TABLE collections');
      tx.run('DROP TABLE cash_cut_lines');
      tx.run('ALTER TABLE cash_movements RENAME TO cm');
      tx.run('DROP TABLE cash_cuts');
      tx.run(`CREATE TABLE cash_movements (id TEXT PRIMARY KEY, register_id TEXT NOT NULL, type TEXT NOT NULL, method TEXT NOT NULL, amount_cents INTEGER NOT NULL,
        description TEXT NOT NULL, ref_type TEXT, ref_id TEXT, cut_id TEXT, user_name TEXT NOT NULL, created_at TEXT NOT NULL)`);
      tx.run('INSERT INTO cash_movements SELECT id, register_id, type, method, amount_cents, description, ref_type, ref_id, cut_id, user_name, created_at FROM cm');
      tx.run('DROP TRIGGER cash_movements_no_delete');
      tx.run('DROP TRIGGER cash_movements_no_update');
      tx.run('DROP TABLE cm');
      tx.run('CREATE TRIGGER cash_movements_no_delete BEFORE DELETE ON cash_movements BEGIN SELECT 1; END');
      tx.run('CREATE TRIGGER cash_movements_no_update BEFORE UPDATE ON cash_movements BEGIN SELECT 1; END');
    });
    const reopened = await openTestDb(bytes!);
    expect(await reopened.read((t) => t.get<{ v: number }>('SELECT max(version) v FROM schema_migrations')!.v)).toBe(LATEST_VERSION);
    expect((await reopened.read(currentCash)).total).toBe(1000);
    await reopened.write((tx) => createCut(tx, { id: crypto.randomUUID(), counted: {} }));
    expect(await reopened.read((t) => t.get<{ n: number }>('SELECT count(*) n FROM cash_movements WHERE cut_id IS NOT NULL')!.n)).toBe(1);
  });
});

