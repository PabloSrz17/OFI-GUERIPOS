/**
 * Importación desde las descargas oficiales de Pulpos (D34): productos, clientes, notas del mes, notas con deuda
 * de cualquier fecha y cortes del mes. Lo importado es historial: no mueve la caja ni el inventario de aquí.
 *
 * Entrada: las filas de cada Excel como objetos { encabezado: valor } (ver tools/import/pulpos.mjs).
 */
import type { Tx } from '@/db/database';
import { createProduct } from '@/repos/products';
import { createClient } from '@/repos/clients';
import { defaultLocationId } from '@/repos/bootstrap';
import { newId, ValidationError } from '@/repos/common';
import { formatMoney } from '@/lib/format';
import { paymentMethodLabel, type CashMethod } from '@/domain/sale';

export type Row = Record<string, unknown>;
export interface PulposData {
  products: Row[];
  clients: Row[];
  /** "Descargar Ventas" (encabezados de venta). */
  sales: Row[];
  /** Reporte "Detalle de Ventas" (un renglón por producto vendido). */
  saleLines: Row[];
  cuts: Row[];
}
export interface ImportOptions {
  /** Mes de las notas y cortes a importar, "2026-11". Las notas con deuda se importan de cualquier mes. */
  month: string;
  /** Horas que hay que sumar a la hora local de Pulpos para tener UTC (México centro: 6). */
  utcOffsetHours?: number;
}
export interface ImportSummary {
  products: number;
  clients: number;
  sales: number;
  salesWithDebt: number;
  debtCents: number;
  salesTotalCents: number;
  cuts: number;
  skipped: string[];
  warnings: string[];
}

const USER = 'Pulpos';
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown) => (typeof v === 'number' ? v : Number(str(v).replace(/[$,\s]/g, '')) || 0);
const cents = (v: unknown) => Math.round(num(v) * 100);
const key = (s: string) => s.normalize('NFC').toUpperCase().replace(/\s+/g, ' ').trim();

/** "23/11/2026 12:00:38" (hora local de Pulpos) → ISO UTC. */
export function pulposDate(v: unknown, utcOffsetHours = 6) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(str(v));
  if (!m) throw new Error(`Fecha no reconocida: "${str(v)}"`);
  const [, d, mo, y, h = '0', mi = '0', s = '0'] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h + utcOffsetHours, +mi, +s)).toISOString();
}
/** Fecha de Excel (número de días desde 1899-12-30) → ISO a mediodía de México. */
export function excelDate(v: unknown) {
  if (typeof v !== 'number') return str(v) ? pulposDate(v) : null;
  const day = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
  day.setUTCHours(18);
  return day.toISOString();
}
/** "N1309" → 1309; "#117" (serie antigua) → -117. */
export function pulposFolio(v: unknown) {
  const m = /^(N|#)\s*(\d+)$/i.exec(str(v));
  if (!m) throw new Error(`Folio no reconocido: "${str(v)}"`);
  return m[1] === '#' ? -Number(m[2]) : Number(m[2]);
}
const monthOf = (pulposFecha: unknown) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(str(pulposFecha));
  return m ? `${m[3]}-${m[2].padStart(2, '0')}` : '';
};

const UNIT_MAP: Record<string, string> = { KILOGRAMO: 'kg', KG: 'kg', METRO: 'm', PIEZA: 'piece', CAJA: 'box', PAQUETE: 'pack', LITRO: 'l', GRAMO: 'g', PAR: 'pair' };
const PAY_COLS: [string, CashMethod][] = [
  ['Pago en Efectivo', 'cash'],
  ['Pago con Tarjeta de Crédito', 'credit_card'],
  ['Pago con Tarjeta de Débito', 'debit_card'],
  ['Pago por Transferencia', 'transfer'],
];
const CUT_METHODS: [string, CashMethod][] = [
  ['Efectivo', 'cash'],
  ['Tarjeta de Crédito', 'credit_card'],
  ['Tarjeta de Débito', 'debit_card'],
  ['Transferencia', 'transfer'],
];
const SKIP_STATES = new Set(['REEMBOLSADA', 'CANCELADA', 'IMPAGA']);

function event(tx: Tx, saleId: string, type: string, title: string, at: string, detail = 'Importado de Pulpos') {
  tx.run('INSERT INTO sale_events (id, sale_id, type, title, detail, user_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [newId(), saleId, type, title, detail, USER, at]);
}

/** Importa todo en la transacción `tx` (pensado para una base nueva con ensureBaseData ya aplicado). */
export function importPulpos(tx: Tx, data: PulposData, opts: ImportOptions): ImportSummary {
  const offset = opts.utcOffsetHours ?? 6;
  const warnings: string[] = [];
  const skipped: string[] = [];
  const publico = tx.get<{ id: string }>('SELECT id FROM price_lists WHERE deleted_at IS NULL ORDER BY position LIMIT 1')!.id;
  const registerId = tx.get<{ id: string }>('SELECT id FROM cash_registers ORDER BY is_default DESC LIMIT 1')!.id;
  const locationId = defaultLocationId(tx);

  // --- Productos (stock en cero, decisión del usuario) ---
  let productCount = 0;
  const usedSku = new Set<string>();
  const usedBarcode = new Set<string>();
  const bySku = new Map<string, { id: string; rate: number; unit: string; track: boolean }>();
  const byName = new Map<string, { id: string; rate: number; unit: string; track: boolean }>();
  for (const p of data.products) {
    const name = str(p['Nombre del Producto']);
    if (!name) continue;
    let sku: string | null = str(p['SKU']) || null;
    if (sku && usedSku.has(sku.toUpperCase())) {
      warnings.push(`SKU repetido "${sku}": se quitó del producto "${name}" (queda en el primero).`);
      sku = null;
    }
    let barcode: string | null = str(p['Código de Barras']) || null;
    if (barcode && usedBarcode.has(barcode)) {
      warnings.push(`Código de barras repetido "${barcode}" en "${name}": se quitó.`);
      barcode = null;
    }
    const unitName = key(str(p['Unidad de Venta']));
    const unit = UNIT_MAP[unitName] ?? 'unit';
    const ivaRate = num(p['IVA']);
    const chargeTaxes = key(str(p['Impuestos'])) !== 'NO';
    const description = str(p['Descripción']);
    const track = key(str(p['Utiliza Stock'])) !== 'NO';
    const id = createProduct(tx, {
      type: key(str(p['Es un Servicio'])) === 'SI' ? 'service' : 'product',
      name,
      sku,
      barcode,
      description: description && description !== name ? description : null,
      newCategoryName: str(p['Categoría']) || null,
      newBrandName: str(p['Marca']) || null,
      unit,
      shelfLocation: str(p['Ubicación ']) || str(p['Ubicación']) || null,
      sellInPos: key(str(p['Se Vende'])) !== 'NO',
      requiresPrescription: key(str(p['Receta Médica'])) === 'SI',
      trackStock: track,
      initialStock: 0,
      minStock: Math.max(0, num(p['Stock Mínimo '] ?? p['Stock Mínimo'])),
      costCents: Math.max(0, cents(p['Costo'])),
      chargeTaxes,
      iva: String(Math.round(ivaRate * 100) || 16),
      ieps: 'none',
      satKey: str(p['Clave SAT']) || null,
      prices: { [publico]: Math.max(0, cents(p['Precio Público'])) },
    });
    if (unit === 'unit' && unitName && unitName !== 'UNIDAD') warnings.push(`Unidad "${str(p['Unidad de Venta'])}" de "${name}" quedó como Unidad.`);
    productCount++;
    const info = { id, rate: chargeTaxes ? ivaRate || 0.16 : 0, unit, track };
    if (sku) (usedSku.add(sku.toUpperCase()), bySku.set(sku.toUpperCase(), info));
    if (barcode) usedBarcode.add(barcode);
    if (!byName.has(key(name))) byName.set(key(name), info);
  }

  // --- Clientes ---
  const clientByName = new Map<string, string>();
  let clientCount = 0;
  const addClient = (c: Row) => {
    const firstName = str(c['Nombre']);
    if (!firstName) return null;
    const lastName = str(c['Apellido']) || null;
    let phone = str(c['Teléfono']).replace(/[\s\-().]/g, '');
    if (phone.startsWith('+52')) phone = phone.slice(3);
    const email = str(c['Email']) || null;
    const comments = str(c['Comentarios']) || null;
    const address = {
      street: str(c['Calle']) || null,
      ext: str(c['Número Exterior']) || null,
      int: str(c['Número Interior']) || null,
      zip: str(c['Código Postal']) || null,
      neighborhood: str(c['Colonia']) || null,
      municipality: str(c['Municipio']) || null,
      city: str(c['Ciudad']) || null,
      state: str(c['Estado']) || null,
    };
    let id: string;
    try {
      id = createClient(tx, { firstName, lastName, phone: phone || null, email, comments, address });
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      // Teléfono o email con formato que aquí no se acepta: se guardan en Comentarios para no perderlos.
      const extra = [phone && `Teléfono: ${str(c['Teléfono'])}`, email && `Email: ${email}`].filter(Boolean).join(' · ');
      id = createClient(tx, { firstName, lastName, comments: [comments, extra].filter(Boolean).join('\n') || null, address });
      warnings.push(`Cliente "${`${firstName} ${lastName ?? ''}`.trim()}": ${e.message}; se guardó en Comentarios.`);
    }
    clientCount++;
    const k = key(`${firstName} ${lastName ?? ''}`);
    if (clientByName.has(k)) warnings.push(`Hay dos clientes llamados "${k}": las notas se asignan al primero.`);
    else clientByName.set(k, id);
    return id;
  };
  for (const c of data.clients) addClient(c);

  // --- Notas: las del mes y todas las que tienen deuda ---
  const linesByFolio = new Map<string, Row[]>();
  for (const l of data.saleLines) {
    const f = str(l['Número de Venta']);
    if (!linesByFolio.has(f)) linesByFolio.set(f, []);
    linesByFolio.get(f)!.push(l);
  }
  let salesCount = 0;
  let salesWithDebt = 0;
  let debtTotal = 0;
  let salesTotal = 0;
  const selected = data.sales.filter((s) => monthOf(s['Fecha']) === opts.month || cents(s['Deuda Actual']) > 0);
  for (const s of [...selected].reverse()) {
    const folioText = str(s['Número de venta']);
    const state = key(str(s['Estado']));
    if (SKIP_STATES.has(state)) {
      skipped.push(`${folioText} (${str(s['Estado'])}, ${formatMoney(num(s['Total']))})`);
      continue;
    }
    const lines = linesByFolio.get(folioText) ?? [];
    if (!lines.length) {
      skipped.push(`${folioText} (sin productos en el Detalle de Ventas)`);
      continue;
    }
    const id = newId();
    const folio = pulposFolio(folioText);
    const at = pulposDate(s['Fecha'], offset);
    const total = cents(s['Total']);
    const debtNow = cents(s['Deuda Actual']);
    const debtInitial = cents(s['Deuda Inicial']);
    const clientName = str(s['Cliente']);
    let clientId: string | null = null;
    if (clientName && key(clientName) !== 'PÚBLICO EN GENERAL') {
      clientId = clientByName.get(key(clientName)) ?? null;
      if (!clientId) {
        clientId = addClient({ Nombre: clientName });
        warnings.push(`La nota ${folioText} es de "${clientName}", que no estaba en Clientes: se creó.`);
      }
    }
    if (debtNow > 0 && !clientId) warnings.push(`La nota ${folioText} tiene deuda pero no tiene cliente.`);

    const pays = PAY_COLS.map(([col, method]) => ({ method, amount: cents(s[col]) })).filter((p) => p.amount > 0);
    const paid = pays.reduce((a, p) => a + p.amount, 0);
    if (paid !== total - debtNow) warnings.push(`La nota ${folioText}: pagos ${formatMoney(paid / 100)} + deuda ${formatMoney(debtNow / 100)} no suman el total ${formatMoney(total / 100)}.`);
    const method = debtInitial > 0 ? 'credit' : (pays.sort((a, b) => b.amount - a.amount)[0]?.method ?? 'cash');
    const delivered = !/^NO /.test(key(str(s['Productos'])));

    let gross = 0;
    let discount = 0;
    let tax = 0;
    const items = lines.map((l, position) => {
      const sku = str(l['SKU']);
      const prod = (sku && bySku.get(sku.toUpperCase())) || byName.get(key(str(l['Producto']))) || null;
      if (!prod) warnings.push(`La nota ${folioText}: el producto "${str(l['Producto'])}" no está en el catálogo (se guarda solo el nombre).`);
      const quantity = num(l['Cantidad']);
      const lineGross = cents(l['Subtotal']);
      const lineDiscount = cents(l['Descuento']);
      const lineTotal = cents(l['Total']);
      const rate = prod?.rate ?? 0.16;
      const lineTax = Math.round(lineTotal - lineTotal / (1 + rate));
      gross += lineGross;
      discount += lineDiscount;
      tax += lineTax;
      const list = key(str(l['Lista de Precios']));
      return {
        id: newId(),
        position,
        product_id: prod?.id ?? null,
        name: str(l['Producto']),
        sku: sku || null,
        unit: prod?.unit ?? 'unit',
        quantity,
        unit_price_cents: cents(l['Precio Unitario']),
        price_list_id: list === 'PRECIO PÚBLICO' || list === 'PÚBLICO' ? publico : null,
        gross_cents: lineGross,
        discount_cents: lineDiscount,
        total_cents: lineTotal,
        tax_rate: rate,
        tax_cents: lineTax,
        cost_cents: quantity > 0 ? Math.round(cents(l['Costo Total']) / quantity) : 0,
        track_stock: prod?.track ? 1 : 0,
      };
    });
    const linesTotal = items.reduce((a, i) => a + i.total_cents, 0);
    if (linesTotal !== total) warnings.push(`La nota ${folioText}: los productos suman ${formatMoney(linesTotal / 100)} y el total es ${formatMoney(total / 100)}.`);

    tx.run(
      `INSERT INTO sales (id, folio, mode, location_id, register_id, client_id, price_list_id, note, taxes_removed, subtotal_cents, discount_cents, taxes_removed_cents,
         tax_cents, total_cents, payment_method, received_cents, change_cents, credit_cents, due_date, delivery_status, delivered_at, user_name, created_at, updated_at, source)
       VALUES (?, ?, 'sale', ?, ?, ?, NULL, ?, 0, ?, ?, 0, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'pulpos')`,
      [
        id,
        folio,
        locationId,
        registerId,
        clientId,
        str(s['Nota']) || null,
        gross,
        discount,
        tax,
        total,
        method,
        method === 'cash' ? (pays.find((p) => p.method === 'cash')?.amount ?? total) : null,
        debtInitial,
        debtInitial > 0 ? excelDate(s['Vencimiento de Deuda']) : null,
        delivered ? 'delivered' : 'pending',
        delivered ? at : null,
        USER,
        at,
        at,
      ],
    );
    for (const i of items)
      tx.run(
        `INSERT INTO sale_items (id, sale_id, position, product_id, name, sku, unit, quantity, unit_price_cents, price_list_id, gross_cents, discount_cents, discount_label,
           taxes_removed_cents, total_cents, tax_rate, tax_cents, cost_cents, track_stock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?)`,
        [i.id, id, i.position, i.product_id, i.name, i.sku, i.unit, i.quantity, i.unit_price_cents, i.price_list_id, i.gross_cents, i.discount_cents, i.total_cents, i.tax_rate, i.tax_cents, i.cost_cents, i.track_stock],
      );

    event(tx, id, 'created', 'Venta Registrada', at);
    if (debtInitial > 0) event(tx, id, 'credit', `Asignación de ${formatMoney(debtInitial / 100)} de Crédito`, at);
    // Lo pagado al vender es "venta"; lo que se abonó después a la deuda, "cobro" (Pulpos no da la fecha de cada abono).
    let atSale = total - debtInitial;
    for (const p of pays) {
      const parts: [number, 'sale' | 'collection'][] = [];
      const forSale = Math.min(p.amount, Math.max(0, atSale));
      atSale -= forSale;
      if (forSale > 0) parts.push([forSale, 'sale']);
      if (p.amount - forSale > 0) parts.push([p.amount - forSale, 'collection']);
      for (const [amount, kind] of parts) {
        tx.run(
          'INSERT INTO payments (id, sale_id, client_id, register_id, kind, method, amount_cents, user_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [newId(), id, clientId, registerId, kind, p.method, amount, USER, at],
        );
        event(tx, id, kind === 'sale' ? 'payment' : 'collection', `${kind === 'sale' ? 'Cobro' : 'Abono'} de ${formatMoney(amount / 100)} en ${paymentMethodLabel(p.method)}`, at);
      }
    }
    event(tx, id, delivered ? 'delivery' : 'reserved', delivered ? 'Entrega de Productos' : 'Apartado de Productos', at);

    salesCount++;
    salesTotal += total;
    if (debtNow > 0) (salesWithDebt++, (debtTotal += debtNow));
  }

  // --- Cortes del mes ---
  const cuts = data.cuts.filter((c) => monthOf(c['Fecha']) === opts.month).map((c) => ({ c, at: pulposDate(c['Fecha'], offset) }));
  cuts.sort((a, b) => a.at.localeCompare(b.at));
  const firstFolio = (tx.get<{ n: number }>('SELECT coalesce(max(folio), 0) AS n FROM cash_cuts')?.n ?? 0) + 1;
  cuts.forEach(({ c, at }, i) => {
    const id = newId();
    const user = str(c['Realizado Por']).replace(/^[.\s]+$/, '') || USER;
    tx.run(
      `INSERT INTO cash_cuts (id, folio, register_id, start_cents, expected_cents, counted_cents, withdrawn_cents, remaining_cents, comments, user_name, created_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pulpos')`,
      [id, firstFolio + i, registerId, cents(c['Efectivo: Al inicio']), cents(c['Total Esperado']), cents(c['Recuento Manual']), cents(c['Efectivo: Retiro por Corte']), cents(c['Efectivo: Restante en Caja']), str(c['Comentarios']) || null, user, at],
    );
    for (const [label, method] of CUT_METHODS)
      tx.run('INSERT INTO cash_cut_lines (cut_id, method, expected_cents, counted_cents) VALUES (?, ?, ?, ?)', [id, method, cents(c[`${label}: Total Esperado`]), Math.max(0, cents(c[`${label}: Recuento Manual`]))]);
  });

  return { products: productCount, clients: clientCount, sales: salesCount, salesWithDebt, debtCents: debtTotal, salesTotalCents: salesTotal, cuts: cuts.length, skipped, warnings };
}
