import { uuid } from '@/lib/uuid';
import * as React from 'react';
import { saleTotals, type LineDiscount } from '@/domain/sale';
import type { SaleInput } from '@/repos/sales';

/**
 * Carritos del punto de venta ("ventas en paralelo"). Viven en el navegador del equipo (localStorage),
 * así un cierre inesperado no pierde lo que se estaba capturando. Al cobrar, la venta se guarda en la base
 * con el id del carrito (llave de idempotencia) y el carrito se descarta.
 */

export interface CartLine {
  key: string;
  productId: string | null; // null = entrada manual
  name: string;
  sku: string | null;
  image: string | null;
  unit: string;
  quantity: number;
  unitPriceCents: number;
  priceListId: string | null; // null = Personalizado
  taxRate: number;
  discount: LineDiscount | null;
  trackStock: boolean;
  stock: number | null;
  manual?: { costCents: number; chargeTaxes: boolean; iva: string; ieps: string };
}

export interface Cart {
  id: string;
  mode: 'sale' | 'order';
  priceListId: string | null;
  client: { id: string; name: string } | null;
  note: string;
  taxesRemoved: boolean;
  deferDelivery: boolean;
  lines: CartLine[];
}

export interface CartsState {
  carts: Cart[];
  activeId: string;
}

const KEY = 'pos.carts.v1';

export const newCart = (priceListId: string | null = null): Cart => ({
  id: uuid(),
  mode: 'sale',
  priceListId,
  client: null,
  note: '',
  taxesRemoved: false,
  deferDelivery: false,
  lines: [],
});

function load(): CartsState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as CartsState;
      if (Array.isArray(s.carts) && s.carts.length) return { carts: s.carts, activeId: s.carts.some((c) => c.id === s.activeId) ? s.activeId : s.carts[0].id };
    }
  } catch {
    // Sin almacenamiento disponible: se trabaja solo en memoria.
  }
  const c = newCart();
  return { carts: [c], activeId: c.id };
}

function save(s: CartsState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignorar
  }
}

export type CartAction =
  | { type: 'update'; patch: Partial<Omit<Cart, 'id' | 'lines'>> }
  | { type: 'add'; line: Omit<CartLine, 'key'> }
  | { type: 'line'; key: string; patch: Partial<CartLine> }
  | { type: 'remove'; key: string }
  | { type: 'clear' }
  | { type: 'reprice'; priceListId: string | null; prices: Record<string, Record<string, number>>; fallbackListId: string | null }
  | { type: 'newTab'; priceListId: string | null }
  | { type: 'select'; id: string }
  | { type: 'close'; id: string; priceListId: string | null }
  | { type: 'finish'; id: string; priceListId: string | null };

function mapActive(s: CartsState, fn: (c: Cart) => Cart): CartsState {
  return { ...s, carts: s.carts.map((c) => (c.id === s.activeId ? fn(c) : c)) };
}

function closeCart(s: CartsState, id: string, priceListId: string | null): CartsState {
  const idx = s.carts.findIndex((c) => c.id === id);
  const rest = s.carts.filter((c) => c.id !== id);
  if (!rest.length) {
    const c = newCart(priceListId);
    return { carts: [c], activeId: c.id };
  }
  const activeId = s.activeId === id ? rest[Math.max(0, idx - 1)].id : s.activeId;
  return { carts: rest, activeId };
}

export function cartsReducer(s: CartsState, a: CartAction): CartsState {
  switch (a.type) {
    case 'update':
      return mapActive(s, (c) => ({ ...c, ...a.patch }));
    case 'add':
      return mapActive(s, (c) => {
        // El mismo producto del catálogo, al mismo precio y sin descuento, suma cantidad en lugar de otro renglón.
        const same = a.line.productId ? c.lines.find((l) => l.productId === a.line.productId && l.unitPriceCents === a.line.unitPriceCents && l.priceListId === a.line.priceListId && !l.discount) : undefined;
        if (same) return { ...c, lines: c.lines.map((l) => (l === same ? { ...l, quantity: Math.round((l.quantity + a.line.quantity) * 1000) / 1000 } : l)) };
        return { ...c, lines: [...c.lines, { ...a.line, key: uuid() }] };
      });
    case 'line':
      return mapActive(s, (c) => ({ ...c, lines: c.lines.map((l) => (l.key === a.key ? { ...l, ...a.patch } : l)) }));
    case 'remove':
      return mapActive(s, (c) => ({ ...c, lines: c.lines.filter((l) => l.key !== a.key) }));
    case 'clear':
      return mapActive(s, (c) => ({ ...c, lines: [] }));
    case 'reprice':
      // Cambiar la lista del carrito actualiza los renglones con precio de lista; los personalizados se respetan.
      return mapActive(s, (c) => ({
        ...c,
        priceListId: a.priceListId,
        lines: c.lines.map((l) => {
          if (!l.productId || l.priceListId === null) return l;
          const prices = a.prices[l.productId] ?? {};
          const listId = a.priceListId && prices[a.priceListId] !== undefined ? a.priceListId : a.fallbackListId;
          return listId && prices[listId] !== undefined ? { ...l, unitPriceCents: prices[listId], priceListId: listId } : l;
        }),
      }));
    case 'newTab': {
      const c = newCart(a.priceListId);
      return { carts: [...s.carts, c], activeId: c.id };
    }
    case 'select':
      return s.carts.some((c) => c.id === a.id) ? { ...s, activeId: a.id } : s;
    case 'close':
    case 'finish':
      return closeCart(s, a.id, a.priceListId);
  }
}

export function useCarts() {
  const [state, dispatch] = React.useReducer(cartsReducer, undefined, load);
  React.useEffect(() => save(state), [state]);
  const active = state.carts.find((c) => c.id === state.activeId) ?? state.carts[0];
  return { state, active, dispatch };
}

export function cartTotals(c: Cart) {
  return saleTotals(c.lines, c.taxesRemoved);
}

export function cartToSaleInput(c: Cart, payment: SaleInput['payment']): SaleInput {
  return {
    id: c.id,
    mode: c.mode,
    clientId: c.client?.id ?? null,
    priceListId: c.priceListId,
    note: c.note,
    taxesRemoved: c.taxesRemoved,
    deferDelivery: c.deferDelivery,
    payment,
    lines: c.lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      priceListId: l.priceListId,
      discount: l.discount,
      ...(l.productId ? {} : { name: l.name, unit: l.unit, ...l.manual }),
    })),
  };
}
