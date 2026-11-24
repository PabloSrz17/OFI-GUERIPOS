// Reglas y catálogos del módulo de productos (reference/pulpos/products.md).

export interface Unit {
  id: string;
  label: string; // "Unidad" (selector, sufijos "Unidad" / "por Unidad")
  plural: string; // "Unidades" (sufijo de cantidades en el editor)
  singular: string; // "unidad" (pill de stock "1 unidad")
  pluralLower: string; // "unidades"
}

/**
 * Unidades de venta. En Pulpos solo se observó "Unidad" (el selector no se desplegó);
 * el resto es una lista base razonable para ferretería/abarrotes (pendiente de confirmar).
 */
export const UNITS: Unit[] = [
  { id: 'unit', label: 'Unidad', plural: 'Unidades', singular: 'unidad', pluralLower: 'unidades' },
  { id: 'piece', label: 'Pieza', plural: 'Piezas', singular: 'pieza', pluralLower: 'piezas' },
  { id: 'kg', label: 'Kilogramo', plural: 'Kilogramos', singular: 'kg', pluralLower: 'kg' },
  { id: 'g', label: 'Gramo', plural: 'Gramos', singular: 'g', pluralLower: 'g' },
  { id: 'l', label: 'Litro', plural: 'Litros', singular: 'litro', pluralLower: 'litros' },
  { id: 'ml', label: 'Mililitro', plural: 'Mililitros', singular: 'ml', pluralLower: 'ml' },
  { id: 'm', label: 'Metro', plural: 'Metros', singular: 'metro', pluralLower: 'metros' },
  { id: 'box', label: 'Caja', plural: 'Cajas', singular: 'caja', pluralLower: 'cajas' },
  { id: 'pack', label: 'Paquete', plural: 'Paquetes', singular: 'paquete', pluralLower: 'paquetes' },
  { id: 'pair', label: 'Par', plural: 'Pares', singular: 'par', pluralLower: 'pares' },
];

export function unitById(id: string | null | undefined): Unit {
  return UNITS.find((u) => u.id === id) ?? UNITS[0];
}

/** Forma que espera formatQuantity: "1 unidad" / "3 unidades". */
export function quantityUnit(id: string | null | undefined) {
  const u = unitById(id);
  return { singular: u.singular, plural: u.pluralLower };
}

// Impuestos observados: IVA "16%" e IEPS "No aplica" por defecto (los demás valores son las tasas vigentes en México).
export const IVA_OPTIONS = [
  { value: '16', label: '16%', rate: 0.16 },
  { value: '8', label: '8%', rate: 0.08 },
  { value: '0', label: '0%', rate: 0 },
  { value: 'exempt', label: 'Exento', rate: 0 },
] as const;

export const IEPS_OPTIONS = [
  { value: 'none', label: 'No aplica', rate: 0 },
  { value: '8', label: '8%', rate: 0.08 },
  { value: '25', label: '25%', rate: 0.25 },
  { value: '26.5', label: '26.5%', rate: 0.265 },
  { value: '30', label: '30%', rate: 0.3 },
  { value: '53', label: '53%', rate: 0.53 },
] as const;

export function ivaLabel(v: string) {
  return IVA_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

/** Tasa combinada (el IEPS forma parte de la base del IVA). */
export function taxRate(p: { chargeTaxes: boolean; iva: string; ieps: string }) {
  if (!p.chargeTaxes) return 0;
  const iva = IVA_OPTIONS.find((o) => o.value === p.iva)?.rate ?? 0;
  const ieps = IEPS_OPTIONS.find((o) => o.value === p.ieps)?.rate ?? 0;
  return (1 + ieps) * (1 + iva) - 1;
}

export type CostMode = 'neto' | 'bruto';

/**
 * En Pulpos el costo "neto" (por defecto) muestra la ayuda "Incluyendo impuestos";
 * se interpreta "bruto" como costo antes de impuestos (decisions.md D5).
 */
export const COST_MODE_HELP: Record<CostMode, string> = {
  neto: 'Incluyendo impuestos',
  bruto: 'Antes de impuestos',
};

/** Costo con impuestos, comparable con el precio de venta (que siempre incluye impuestos). */
export function costWithTaxesCents(costCents: number, mode: CostMode, rate: number) {
  return mode === 'neto' ? costCents : Math.round(costCents * (1 + rate));
}

/**
 * Margen sobre el precio, como en Pulpos (precio $12, costo $0 → 100 % y ganancia $12).
 * Con precio 0 el margen es 0 %.
 */
export function margin(priceCents: number, costCents: number) {
  const profitCents = priceCents - costCents;
  return { profitCents, ratio: priceCents > 0 ? profitCents / priceCents : 0 };
}

export function formatPercent(ratio: number) {
  const pct = Math.round(ratio * 1000) / 10;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

/** Texto de búsqueda: minúsculas y sin acentos, para buscar "jabon" y encontrar "Jabón". */
export function normalizeSearch(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** "12.5" → 1250 centavos; texto vacío o inválido → 0. */
export function parseMoneyToCents(input: string | number | null | undefined) {
  if (input === null || input === undefined || input === '') return 0;
  const n = typeof input === 'number' ? input : Number(String(input).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function centsToInput(cents: number) {
  return cents === 0 ? '' : (cents / 100).toFixed(2);
}

export function parseQuantity(input: string | number | null | undefined) {
  if (input === null || input === undefined || input === '') return 0;
  const n = typeof input === 'number' ? input : Number(String(input).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}
