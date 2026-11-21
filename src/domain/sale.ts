/**
 * Cálculo del carrito, compartido por el punto de venta (para mostrar) y el repositorio (que lo recalcula al guardar;
 * nunca confía en los totales que manda la pantalla). Todo en centavos.
 *
 * Los precios de venta ya incluyen impuestos, como en Pulpos. "Quitar Impuestos de la Venta" cobra cada renglón
 * sin ellos: precio / (1 + tasa) (interpretación propia, decisions.md D13).
 */

export type PaymentMethod = 'cash' | 'credit_card' | 'debit_card' | 'transfer' | 'credit';
export type CashMethod = Exclude<PaymentMethod, 'credit'>;

/** Métodos observados en el historial y la caja de Pulpos, en ese orden. */
export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'credit_card', label: 'Tarjeta de Crédito' },
  { value: 'debit_card', label: 'Tarjeta de Débito' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'credit', label: 'A Crédito' },
];

export function paymentMethodLabel(m: string) {
  return PAYMENT_METHODS.find((p) => p.value === m)?.label ?? m;
}

export interface LineDiscount {
  type: 'amount' | 'percent';
  /** Centavos si es monto; porcentaje (0–100) si es porcentaje. */
  value: number;
  label?: string | null;
}

export interface LineInput {
  quantity: number;
  unitPriceCents: number;
  taxRate: number;
  discount?: LineDiscount | null;
}

export interface LineTotals {
  grossCents: number;
  discountCents: number;
  taxesRemovedCents: number;
  totalCents: number;
  taxCents: number;
}

export function lineTotals(line: LineInput, taxesRemoved = false): LineTotals {
  const grossCents = Math.round(line.quantity * line.unitPriceCents);
  const d = line.discount;
  let discountCents = 0;
  if (d && d.value > 0) discountCents = d.type === 'percent' ? Math.round((grossCents * Math.min(d.value, 100)) / 100) : Math.round(d.value);
  discountCents = Math.min(Math.max(discountCents, 0), grossCents);
  const afterDiscount = grossCents - discountCents;
  const base = Math.round(afterDiscount / (1 + line.taxRate));
  if (taxesRemoved) return { grossCents, discountCents, taxesRemovedCents: afterDiscount - base, totalCents: base, taxCents: 0 };
  return { grossCents, discountCents, taxesRemovedCents: 0, totalCents: afterDiscount, taxCents: afterDiscount - base };
}

export interface SaleTotals extends LineTotals {
  itemCount: number;
  lines: LineTotals[];
}

export function saleTotals(lines: LineInput[], taxesRemoved = false): SaleTotals {
  const each = lines.map((l) => lineTotals(l, taxesRemoved));
  const sum = (k: keyof LineTotals) => each.reduce((s, l) => s + l[k], 0);
  return {
    grossCents: sum('grossCents'),
    discountCents: sum('discountCents'),
    taxesRemovedCents: sum('taxesRemovedCents'),
    totalCents: sum('totalCents'),
    taxCents: sum('taxCents'),
    itemCount: lines.length,
    lines: each,
  };
}

/** Cambio a entregar en efectivo; null si lo recibido no alcanza. */
export function changeFor(totalCents: number, receivedCents: number) {
  return receivedCents >= totalCents ? receivedCents - totalCents : null;
}

/** Billetes sugeridos para cobrar en efectivo: el exacto y los siguientes múltiplos de 50, 100, 200, 500 y 1000. */
export function cashSuggestions(totalCents: number) {
  const out = new Set<number>([totalCents]);
  for (const bill of [5000, 10000, 20000, 50000, 100000]) {
    const v = Math.ceil(totalCents / bill) * bill;
    if (v > totalCents) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 4);
}

export const saleFolio = (folio: number) => `N${folio}`;

/** "Vence en 15 días", "Vence mañana", "Vence hoy", "Venció ayer", "Venció hace 6 días" (por días de calendario). */
export function dueText(dueIso: string, now = new Date()) {
  const due = new Date(dueIso);
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((day(due) - day(now)) / 86_400_000);
  if (diff > 1) return `Vence en ${diff} días`;
  if (diff === 1) return 'Vence mañana';
  if (diff === 0) return 'Vence hoy';
  if (diff === -1) return 'Venció ayer';
  return `Venció hace ${-diff} días`;
}
