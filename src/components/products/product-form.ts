import type { ComboValue } from '@/components/ui/combobox';
import { centsToInput, parseMoneyToCents, parseQuantity, type CostMode } from '@/domain/catalog';
import type { ProductDetail, ProductInput, ProductType } from '@/repos/products';

/** Estado del formulario (compartido por "Crear Producto Rápido" y el editor completo). Los números van como texto. */
export interface ProductFormState {
  type: ProductType;
  name: string;
  sku: string;
  barcode: string;
  description: string;
  category: ComboValue;
  brand: ComboValue;
  unit: string;
  shelfLocation: string;
  sellInPos: boolean;
  requiresPrescription: boolean;
  trackStock: boolean;
  initialStock: string;
  minStock: string;
  cost: string;
  costMode: CostMode;
  chargeTaxes: boolean;
  iva: string;
  ieps: string;
  satKey: string;
  image: string | null;
  prices: Record<string, string>;
}

export function emptyProductForm(type: ProductType = 'product'): ProductFormState {
  return {
    type,
    name: '',
    sku: '',
    barcode: '',
    description: '',
    category: null,
    brand: null,
    unit: 'unit',
    shelfLocation: '',
    sellInPos: true,
    requiresPrescription: false,
    trackStock: true,
    initialStock: '',
    minStock: '',
    cost: '',
    costMode: 'neto',
    chargeTaxes: true,
    iva: '16',
    ieps: 'none',
    satKey: '',
    image: null,
    prices: {},
  };
}

export function formFromProduct(p: ProductDetail): ProductFormState {
  return {
    type: p.type,
    name: p.name,
    sku: p.sku ?? '',
    barcode: p.barcode ?? '',
    description: p.description ?? '',
    category: p.category_id && p.category_name ? { id: p.category_id, name: p.category_name } : null,
    brand: p.brand_id && p.brand_name ? { id: p.brand_id, name: p.brand_name } : null,
    unit: p.unit,
    shelfLocation: p.shelf_location ?? '',
    sellInPos: !!p.sell_in_pos,
    requiresPrescription: !!p.requires_prescription,
    trackStock: !!p.track_stock,
    initialStock: '',
    minStock: p.stock[0]?.min_quantity ? String(p.stock[0].min_quantity) : '',
    cost: centsToInput(p.cost_cents),
    costMode: p.cost_mode,
    chargeTaxes: !!p.charge_taxes,
    iva: p.iva,
    ieps: p.ieps,
    satKey: p.sat_key ?? '',
    image: p.image,
    prices: Object.fromEntries(p.prices.filter((x) => x.price_cents !== null).map((x) => [x.price_list_id, centsToInput(x.price_cents!)])),
  };
}

export function inputFromForm(f: ProductFormState): ProductInput {
  return {
    type: f.type,
    name: f.name,
    sku: f.sku,
    barcode: f.barcode,
    description: f.description,
    categoryId: f.category?.id ?? null,
    newCategoryName: f.category && f.category.id === null ? f.category.name : null,
    brandId: f.brand?.id ?? null,
    newBrandName: f.brand && f.brand.id === null ? f.brand.name : null,
    unit: f.unit,
    shelfLocation: f.shelfLocation,
    sellInPos: f.sellInPos,
    requiresPrescription: f.requiresPrescription,
    trackStock: f.trackStock,
    initialStock: parseQuantity(f.initialStock),
    minStock: parseQuantity(f.minStock),
    costCents: parseMoneyToCents(f.cost),
    costMode: f.costMode,
    chargeTaxes: f.chargeTaxes,
    iva: f.iva,
    ieps: f.ieps,
    satKey: f.satKey,
    image: f.image,
    // Precio vacío = 0, igual que Pulpos ("$0" en el detalle).
    prices: Object.fromEntries(Object.entries(f.prices).map(([k, v]) => [k, parseMoneyToCents(v)])),
  };
}

/** Para "Tienes cambios sin guardar". */
export function isDirty(a: ProductFormState, b: ProductFormState) {
  return JSON.stringify(a) !== JSON.stringify(b);
}
