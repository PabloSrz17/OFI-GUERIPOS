import { describe, expect, it } from 'vitest';
import { createTestDb } from '@/db/test-db';
import { balanceSql } from '@/repos/common';
import type { Tx } from '@/db/database';
import { importPulpos, pulposDate, pulposFolio, excelDate, type PulposData } from './pulpos';
import { saleFolio } from '@/domain/sale';
import { deleteSale } from '@/repos/sales';
import { createCollection } from '@/repos/collections';

const product = (name: string, sku: string, price: number, cost: number) => ({ 'Nombre del Producto': name, SKU: sku, 'Es un Servicio': 'No', 'Se Vende': 'Si', 'Unidad de Venta': 'Unidad', 'Utiliza Stock': 'Si', 'Stock Total ': 50, 'Stock Mínimo ': 0, 'Precio Público': price, Costo: cost, Impuestos: 'Si', IVA: 0.16 });
const sale = (folio: string, fecha: string, more: Record<string, unknown>) => ({ 'Número de venta': folio, Fecha: fecha, Estado: 'Pagada', Productos: 'Entregados', Total: 0, 'Pago en Efectivo': 0, 'Pago con Tarjeta de Crédito': 0, 'Pago con Tarjeta de Débito': 0, 'Pago por Transferencia': 0, 'Deuda Inicial': 0, 'Deuda Actual': 0, ...more });
const line = (folio: string, producto: string, sku: string, qty: number, price: number, cost: number) => ({ 'Número de Venta': folio, Producto: producto, SKU: sku, Cantidad: qty, 'Precio Unitario': price, Subtotal: qty * price, Descuento: 0, Total: qty * price, 'Costo Total': qty * cost, 'Lista de Precios': 'Precio Público' });

const data: PulposData = {
  products: [product('CEMENTO GRIS 50 KG', 'CTO', 280, 232), product('VARILLA 3/8', 'VAR', 180, 135)],
  clients: [{ Nombre: 'ANA', Apellido: 'PEREZ', Teléfono: '+529811234567' }, { Nombre: 'BETO', Apellido: null, Teléfono: '12' }],
  sales: [
    sale('N20', '22/11/2026 10:00:00', { Total: 460, 'Pago en Efectivo': 300, 'Pago por Transferencia': 160 }),
    sale('N19', '21/11/2026 09:00:00', { Total: 280, Estado: 'Reembolsada' }),
    sale('N5', '02/10/2026 12:00:00', { Total: 560, Cliente: 'ANA PEREZ', Estado: 'Deuda pendiente', Productos: 'No Entregados', 'Pago en Efectivo': 100, 'Deuda Inicial': 560, 'Deuda Actual': 460, 'Vencimiento de Deuda': 46327 }),
    sale('N4', '01/10/2026 12:00:00', { Total: 180, 'Pago en Efectivo': 180 }),
    sale('#117', '10/03/2026 13:12:35', { Total: 180, Cliente: 'CARLOS NUEVO', Estado: 'Deuda pendiente', 'Deuda Inicial': 180, 'Deuda Actual': 180 }),
  ],
  saleLines: [line('N20', 'CEMENTO GRIS 50 KG', 'CTO', 1, 280, 232), line('N20', 'VARILLA 3/8', '', 1, 180, 135), line('N5', 'CEMENTO GRIS 50 KG', 'CTO', 2, 280, 232), line('N4', 'VARILLA 3/8', 'VAR', 1, 180, 135), line('#117', 'VARILLA 3/8', 'VAR', 1, 180, 135)],
  cuts: [
    { Fecha: '21/11/2026 14:34:53', 'Realizado Por': '. .', 'Total Esperado': 617.08, 'Recuento Manual': 617.08, 'Efectivo: Al inicio': 0, 'Efectivo: Total Esperado': 564.08, 'Efectivo: Recuento Manual': 564.08, 'Efectivo: Retiro por Corte': 564.08, 'Efectivo: Restante en Caja': 0, 'Transferencia: Total Esperado': 53, 'Transferencia: Recuento Manual': 53 },
    { Fecha: '30/10/2026 14:00:00', 'Total Esperado': 1, 'Recuento Manual': 1 },
  ],
};

const getSaleDebt = (tx: Tx, id: string) => tx.get<{ d: number }>(`SELECT ${balanceSql('s')} d FROM sales s WHERE s.id = ?`, [id])!.d;

describe('importación desde Pulpos', () => {
  it('fechas, folios y vencimientos', () => {
    expect(pulposDate('23/11/2026 12:00:38')).toBe('2026-11-23T18:00:38.000Z');
    expect(pulposFolio('N1309')).toBe(1309);
    expect(pulposFolio('#117')).toBe(-117);
    expect(saleFolio(-117)).toBe('#117');
    expect(excelDate(46364)).toBe('2026-12-08T18:00:00.000Z');
  });

  it('importa catálogo, clientes, notas del mes, deudas de cualquier mes y cortes del mes', async () => {
    const db = await createTestDb();
    const s = await db.write((tx) => importPulpos(tx, data, { month: '2026-11' }));
    expect(s).toMatchObject({ products: 2, clients: 3, sales: 3, salesWithDebt: 2, debtCents: 64000, cuts: 1 });
    expect(s.skipped).toEqual(['N19 (Reembolsada, $280.00)']);
    expect(s.warnings).toContain('La nota #117 es de "CARLOS NUEVO", que no estaba en Clientes: se creó.');
    expect(s.warnings.some((w) => w.startsWith('Cliente "BETO"'))).toBe(true);

    const rows = await db.read((tx) => tx.all<{ folio: number; payment_method: string; delivery_status: string; credit_cents: number; due_date: string | null; source: string }>('SELECT folio, payment_method, delivery_status, credit_cents, due_date, source FROM sales ORDER BY folio'));
    expect(rows).toEqual([
      { folio: -117, payment_method: 'credit', delivery_status: 'delivered', credit_cents: 18000, due_date: null, source: 'pulpos' },
      { folio: 5, payment_method: 'credit', delivery_status: 'pending', credit_cents: 56000, due_date: '2026-11-01T18:00:00.000Z', source: 'pulpos' },
      { folio: 20, payment_method: 'cash', delivery_status: 'delivered', credit_cents: 0, due_date: null, source: 'pulpos' },
    ]);
    // Pagos mixtos y abono posterior (cobro).
    expect(await db.read((tx) => tx.all('SELECT s.folio, p.kind, p.method, p.amount_cents FROM payments p JOIN sales s ON s.id = p.sale_id ORDER BY s.folio, p.amount_cents DESC'))).toEqual([
      { folio: 5, kind: 'collection', method: 'cash', amount_cents: 10000 },
      { folio: 20, kind: 'sale', method: 'cash', amount_cents: 30000 },
      { folio: 20, kind: 'sale', method: 'transfer', amount_cents: 16000 },
    ]);
    // Renglones ligados al catálogo por SKU o, sin SKU, por nombre; costo unitario.
    expect(await db.read((tx) => tx.all("SELECT i.name, i.cost_cents, i.product_id IS NOT NULL linked, i.tax_cents FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.folio = 20 ORDER BY position"))).toEqual([
      { name: 'CEMENTO GRIS 50 KG', cost_cents: 23200, linked: 1, tax_cents: 3862 },
      { name: 'VARILLA 3/8', cost_cents: 13500, linked: 1, tax_cents: 2483 },
    ]);
    // Historial, sin caja ni inventario: la caja abierta está en cero y el stock también.
    expect(await db.read((tx) => tx.get('SELECT (SELECT count(*) FROM cash_movements) mov, (SELECT count(*) FROM inventory_movements) inv, (SELECT count(*) FROM stock_levels WHERE quantity <> 0) stock'))).toEqual({ mov: 0, inv: 0, stock: 0 });
    expect(await db.read((tx) => tx.get("SELECT folio, counted_cents, source, (SELECT counted_cents FROM cash_cut_lines l WHERE l.cut_id = c.id AND method = 'transfer') transfer FROM cash_cuts c"))).toEqual({ folio: 1, counted_cents: 61708, source: 'pulpos', transfer: 5300 });

    // La deuda importada se cobra normalmente aquí (y ese dinero sí entra a la caja), pero la nota no se elimina.
    const n5 = (await db.read((tx) => tx.get<{ id: string }>('SELECT id FROM sales WHERE folio = 5')))!.id;
    expect(await db.read((tx) => getSaleDebt(tx, n5))).toBe(46000);
    await db.write((tx) => createCollection(tx, { id: crypto.randomUUID(), saleId: n5, amountCents: 46000, method: 'cash' }));
    expect(await db.read((tx) => getSaleDebt(tx, n5))).toBe(0);
    expect(await db.read((tx) => tx.get<{ n: number }>("SELECT sum(amount_cents) n FROM cash_movements WHERE cut_id IS NULL")!.n)).toBe(46000);
    await expect(db.write((tx) => deleteSale(tx, n5))).rejects.toThrow('se importó de Pulpos');
  });
});
