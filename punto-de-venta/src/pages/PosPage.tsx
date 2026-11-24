import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Banknote,
  Barcode,
  Calculator,
  Check,
  ChevronDown,
  CircleDollarSign,
  FileText,
  MoreHorizontal,
  Plus,
  Search,
  StickyNote,
  Trash2,
  Truck,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, StockBadge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ConfirmDialog, useToast } from '@/components/ui/feedback';
import { Kbd, Shortcut, Thumb } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { QuickCreateProductDialog } from '@/components/products/QuickCreateProductDialog';
import { ClientPickerDialog, DiscountDialog, ManualEntryDialog, NoteDialog, PriceChoiceDialog } from '@/components/pos/PosDialogs';
import { CheckoutDialog } from '@/components/pos/CheckoutDialog';
import { useDb, useLiveQuery } from '@/db/hooks';
import { parseQuantity, quantityUnit, taxRate } from '@/domain/catalog';
import { lineTotals } from '@/domain/sale';
import { listPriceLists } from '@/repos/categories';
import { clientName, getClient } from '@/repos/clients';
import { getProduct } from '@/repos/products';
import { posFindByCode, posSearch, productPriceMap, type PosProduct } from '@/repos/sales';
import { printSaleTicket } from '@/sales/ticket';
import { formatMoney, formatQuantity } from '@/lib/format';
import { cn } from '@/lib/utils';
import { cartTotals, useCarts, type Cart, type CartLine } from '@/pos/cart-store';

const money = (c: number) => formatMoney(c / 100);

// Acciones del POS (sales.md §C). Se omiten Promoción, Vendedor y Recargas: fuera del alcance (D6, D8).
type ActionId = 'create' | 'manual' | 'client' | 'note';
const ACTIONS: { id: ActionId; label: string; icon: typeof Plus; tone: string; keys?: string[] }[] = [
  { id: 'create', label: 'Crear producto', icon: Plus, tone: 'bg-teal-50 text-teal-700' },
  { id: 'manual', label: 'Entrada manual', icon: Calculator, tone: 'bg-sky-50 text-sky-700', keys: ['Ctrl', 'Shift', 'M'] },
  { id: 'client', label: 'Añadir cliente', icon: UserPlus, tone: 'bg-red-50 text-red-600', keys: ['Ctrl', 'Shift', 'C'] },
  { id: 'note', label: 'Añadir nota', icon: FileText, tone: 'bg-green-50 text-green-700', keys: ['Ctrl', 'Shift', 'L'] },
];

function lineFromProduct(p: PosProduct, rate: number): Omit<CartLine, 'key'> {
  return {
    productId: p.id,
    name: p.name,
    sku: p.sku,
    image: p.image,
    unit: p.unit,
    quantity: 1,
    unitPriceCents: p.price_cents,
    priceListId: p.price_list_id,
    taxRate: rate,
    discount: null,
    trackStock: p.type === 'product' && !!p.track_stock,
    stock: p.stock,
  };
}

// ---------- Columna izquierda ----------

function ProductSearch({
  priceListId,
  inputRef,
  onAdd,
  onAction,
  onCreate,
  onToCart,
}: {
  priceListId: string | null;
  inputRef: React.RefObject<HTMLInputElement>;
  onAdd: (p: PosProduct) => void;
  onAction: (a: ActionId) => void;
  onCreate: (name: string) => void;
  onToCart: () => void;
}) {
  const db = useDb();
  const toast = useToast();
  const [q, setQ] = React.useState('');
  const [index, setIndex] = React.useState(0);
  const results = useLiveQuery((tx) => posSearch(tx, q, priceListId), [q, priceListId]) ?? [];
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => setIndex(0), [q]);
  React.useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const add = (p: PosProduct) => {
    onAdd(p);
    setQ('');
    inputRef.current?.focus();
  };

  async function onEnter() {
    const term = q.trim();
    if (!term) return;
    // Lector de códigos: el código exacto se agrega aunque la búsqueda en vivo no haya terminado.
    const exact = await db.read((tx) => posFindByCode(tx, term, priceListId));
    if (exact) return add(exact);
    if (index < results.length) return add(results[index]);
    if (index === results.length) return onCreate(term);
    toast.error(`No se encontró "${term}"`);
  }

  return (
    <section aria-label="Buscar productos" className="flex w-[640px] shrink-0 flex-col overflow-y-auto border-r border-gray-200 px-6 pb-6">
      <h2 className="py-6 font-display text-2xl font-extrabold text-gray-900">Buscar productos</h2>
      <div className="flex h-[46px] items-stretch overflow-hidden rounded-md border border-gray-300 bg-white focus-within:border-sky-500 focus-within:ring-1 focus-within:ring-sky-500">
        <span className="flex items-center px-3 text-gray-400">
          <Search className="size-5" />
        </span>
        <input
          ref={inputRef}
          aria-label="Buscar productos"
          placeholder="Buscar productos"
          autoComplete="off"
          className="min-w-0 flex-1 border-x border-gray-300 px-2 text-base outline-none placeholder:text-gray-400"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(results.length, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter' && !e.ctrlKey) {
              e.preventDefault();
              onEnter();
            } else if (e.key === 'Escape') {
              setQ('');
            } else if (e.key === 'Tab' && !e.shiftKey && q) {
              e.preventDefault();
              setQ('');
              onToCart();
            }
          }}
        />
        <span className="flex items-center gap-2 px-4 text-gray-500">
          {!q && <Shortcut keys={['Ctrl', 'K']} />}
          <Barcode className="size-5" />
        </span>
      </div>

      {q.trim() ? (
        <div className="mt-3 overflow-hidden rounded-lg bg-white shadow-card">
          <div ref={listRef} role="listbox" aria-label="Resultados" className="max-h-[calc(100vh-260px)] overflow-y-auto">
            {results.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={i === index}
                data-index={i}
                onMouseEnter={() => setIndex(i)}
                onClick={() => add(p)}
                className={cn('flex w-full items-center gap-4 px-4 py-3 text-left', i === index && 'bg-gray-50')}
              >
                <Thumb src={p.image ?? undefined} />
                <span className="min-w-0 flex-1">
                  {p.sku && <span className="block text-xs text-gray-500">{p.sku}</span>}
                  <span className="block truncate text-sm font-medium text-gray-900">{p.name}</span>
                  <span className="block text-sm text-gray-600">{money(p.price_cents)}</span>
                </span>
                {p.type === 'product' && !!p.track_stock && <StockBadge quantity={p.stock} label={formatQuantity(p.stock, quantityUnit(p.unit))} />}
              </button>
            ))}
            <button
              type="button"
              role="option"
              aria-selected={index === results.length}
              data-index={results.length}
              onMouseEnter={() => setIndex(results.length)}
              onClick={() => onCreate(q.trim())}
              className={cn('flex w-full items-center gap-4 border-t border-gray-200 px-3 py-4 text-left text-sm text-gray-700', index === results.length && 'bg-gray-50')}
            >
              <span className="flex size-10 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                <Plus className="size-5" />
              </span>
              <span>
                Crear producto "<b className="text-gray-900">{q.trim()}</b>"
              </span>
            </button>
          </div>
          <div className="flex justify-between border-t border-gray-200 bg-white px-4 py-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> Navegar
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Tab</Kbd> Ir al carrito
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-lg bg-white shadow-card">
          {ACTIONS.map(({ id, label, icon: Icon, tone, keys }, i) => (
            <button
              key={id}
              type="button"
              onClick={() => onAction(id)}
              className={cn('group flex flex-col items-start gap-4 border-gray-200 p-6 text-left hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none', i % 2 === 0 && 'border-r', i < 2 && 'border-b')}
            >
              <span className={cn('flex size-10 items-center justify-center rounded-lg', tone)}>
                <Icon className="size-5" />
              </span>
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-base font-medium text-gray-900">{label}</span>
                {keys && <Shortcut keys={keys} className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- Renglón del carrito ----------

function QuantityInput({ line, onChange, index }: { line: CartLine; onChange: (q: number) => void; index: number }) {
  const [text, setText] = React.useState(String(line.quantity));
  React.useEffect(() => setText(String(line.quantity)), [line.quantity]);
  const commit = () => {
    const q = parseQuantity(text);
    if (q > 0) onChange(q);
    else setText(String(line.quantity));
  };
  return (
    <input
      type="number"
      min={0}
      step="any"
      inputMode="decimal"
      aria-label={`Cantidad de ${line.name}`}
      data-cart-qty={index}
      className="h-[38px] w-[120px] rounded-md border border-gray-300 bg-white px-4 text-base text-gray-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const q = parseQuantity(e.target.value);
        if (q > 0) onChange(q);
      }}
      onBlur={commit}
      onFocus={(e) => e.target.select()}
    />
  );
}

function CartLineRow({
  line,
  index,
  taxesRemoved,
  onQuantity,
  onPrice,
  onDiscount,
  onRemove,
}: {
  line: CartLine;
  index: number;
  taxesRemoved: boolean;
  onQuantity: (q: number) => void;
  onPrice: () => void;
  onDiscount: () => void;
  onRemove: () => void;
}) {
  const navigate = useNavigate();
  const t = lineTotals(line, taxesRemoved);
  return (
    <div
      className="flex items-center gap-4 rounded-lg bg-gray-50 px-4 py-4 shadow-card"
      data-testid="cart-line"
      onKeyDown={(e) => {
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
          e.preventDefault();
          onPrice();
        } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
          e.preventDefault();
          onDiscount();
        }
      }}
    >
      <Thumb src={line.image ?? undefined} size={48} />
      <div className="min-w-0 flex-1">
        {line.sku && <p className="truncate text-xs text-gray-500">{line.sku}</p>}
        <p className="truncate text-sm font-medium text-gray-900">{line.name}</p>
        <p className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
          {money(line.unitPriceCents)}
          {line.productId && line.priceListId === null && (
            <Badge className="bg-violet-50 text-violet-700">
              <CircleDollarSign />
              Personalizado
            </Badge>
          )}
          {!line.productId && <Badge>Entrada manual</Badge>}
        </p>
        {t.discountCents > 0 && (
          <p className="text-xs text-green-700">
            Descuento{line.discount?.label ? ` ${line.discount.label}` : ''}: -{money(t.discountCents)}
            {line.discount?.type === 'percent' ? ` (${line.discount.value}%)` : ''}
          </p>
        )}
      </div>
      <QuantityInput line={line} index={index} onChange={onQuantity} />
      <div className="w-24 text-right">
        <p className="text-sm font-semibold text-gray-900">{money(t.totalCents)}</p>
        {t.discountCents > 0 && <p className="text-xs text-gray-400 line-through">{money(t.grossCents)}</p>}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`Opciones de ${line.name}`} className="rounded-md p-1.5 text-gray-600 hover:bg-gray-200">
            <MoreHorizontal className="size-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72">
          <DropdownMenuItem disabled={!line.productId} onSelect={onPrice} shortcut={<Shortcut keys={['Ctrl', 'Shift', 'P']} />}>
            Cambiar Precio
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDiscount} shortcut={<Shortcut keys={['Ctrl', 'Shift', 'D']} />}>
            {line.discount ? 'Editar Descuento' : 'Añadir Descuento'}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!line.productId} onSelect={() => navigate(`/products/detail?id=${line.productId}`)}>
            Ver Detalles
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!line.productId} onSelect={() => navigate(`/products/edit?id=${line.productId}`)}>
            Editar Producto
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-red-700" onSelect={onRemove} shortcut={<Kbd>Supr</Kbd>}>
            Eliminar Producto
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------- Página ----------

type Modal = null | 'manual' | 'client' | 'note' | 'checkout' | 'create';

export function PosPage() {
  const db = useDb();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const { state, active: cart, dispatch } = useCarts();
  const lists = useLiveQuery(listPriceLists, []) ?? [];
  const mainListId = lists[0]?.id ?? null;
  const listId = cart.priceListId ?? mainListId;
  const totals = cartTotals(cart);
  const [modal, setModal] = React.useState<Modal>(null);
  const [createName, setCreateName] = React.useState('');
  const [priceLine, setPriceLine] = React.useState<CartLine | null>(null);
  const [discountLine, setDiscountLine] = React.useState<CartLine | null>(null);
  const [closing, setClosing] = React.useState<Cart | null>(null);
  // Copia del carrito que se está cobrando: al registrarse la venta el carrito se descarta,
  // pero la pantalla de éxito sigue mostrando sus datos.
  const [checkoutCart, setCheckoutCart] = React.useState<Cart | null>(null);
  // "Asignar Cliente" desde el cobro: al elegirlo se vuelve al cobro con el carrito actualizado.
  const [returnToCheckout, setReturnToCheckout] = React.useState(false);
  const [reopenCheckout, setReopenCheckout] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const linesRef = React.useRef<HTMLDivElement>(null);

  const addProduct = React.useCallback(
    async (p: PosProduct) => {
      const rate = await db.read((tx) => {
        const d = getProduct(tx, p.id);
        return d ? taxRate({ chargeTaxes: !!d.charge_taxes, iva: d.iva, ieps: d.ieps }) : 0;
      });
      dispatch({ type: 'add', line: lineFromProduct(p, rate) });
    },
    [db, dispatch],
  );

  const assignClient = React.useCallback(
    async (id: string | null) => {
      if (!id) {
        dispatch({ type: 'update', patch: { client: null } });
        return;
      }
      const info = await db.read((tx) => {
        const c = getClient(tx, id);
        if (!c) return null;
        const ids = cart.lines.map((l) => l.productId).filter((x): x is string => !!x);
        return { id: c.id, name: clientName(c), priceListId: c.price_list_id, prices: productPriceMap(tx, ids) };
      });
      if (!info) return;
      dispatch({ type: 'update', patch: { client: { id: info.id, name: info.name } } });
      // Cliente con lista de precios asignada: el carrito usa esa lista (clients.md, "Precios").
      if (info.priceListId && info.priceListId !== listId) dispatch({ type: 'reprice', priceListId: info.priceListId, prices: info.prices, fallbackListId: mainListId });
    },
    [db, dispatch, cart.lines, listId, mainListId],
  );

  async function changeList(id: string) {
    const ids = cart.lines.map((l) => l.productId).filter((x): x is string => !!x);
    const prices = await db.read((tx) => productPriceMap(tx, ids));
    dispatch({ type: 'reprice', priceListId: id, prices, fallbackListId: mainListId });
  }

  // "Nueva Venta" desde el detalle del cliente: /pos?client=<id>.
  React.useEffect(() => {
    const id = sp.get('client');
    if (!id) return;
    if (cart.lines.length || cart.client) dispatch({ type: 'newTab', priceListId: mainListId });
    setTimeout(() => assignClient(id), 0);
    setSp({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  const openCheckout = React.useCallback(() => {
    if (!cart.lines.length) return;
    setCheckoutCart(cart);
    setModal('checkout');
  }, [cart]);

  React.useEffect(() => {
    if (!reopenCheckout) return;
    setReopenCheckout(false);
    openCheckout();
  }, [reopenCheckout, openCheckout]);

  const onAction = React.useCallback((a: ActionId) => {
    if (a === 'create') {
      setCreateName('');
      setModal('create');
    } else setModal(a);
  }, []);

  // Atajos del POS.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal || priceLine || discountLine || closing) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && !e.shiftKey && k === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        openCheckout();
      } else if (e.ctrlKey && e.shiftKey && k === 'm') {
        e.preventDefault();
        setModal('manual');
      } else if (e.ctrlKey && e.shiftKey && k === 'c') {
        e.preventDefault();
        setModal('client');
      } else if (e.ctrlKey && e.shiftKey && k === 'l') {
        e.preventDefault();
        setModal('note');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, priceLine, discountLine, closing, openCheckout]);

  React.useEffect(() => {
    searchRef.current?.focus();
  }, [state.activeId]);

  const tabLabel = (c: Cart) => c.client?.name ?? (c.mode === 'order' ? 'Nuevo Pedido' : 'Nueva Venta');
  const isOrder = cart.mode === 'order';
  const deferred = isOrder || cart.deferDelivery;

  return (
    <div className="flex h-full">
      <ProductSearch
        priceListId={listId}
        inputRef={searchRef}
        onAdd={addProduct}
        onAction={onAction}
        onCreate={(name) => {
          setCreateName(name);
          setModal('create');
        }}
        onToCart={() => (linesRef.current?.querySelector('[data-cart-qty]') as HTMLInputElement | null)?.focus()}
      />

      {/* Columna derecha: carrito */}
      <section aria-label="Venta" className="flex min-w-0 flex-1 flex-col bg-white">
        <div role="tablist" aria-label="Ventas en curso" className="flex h-[50px] items-end gap-1 overflow-x-auto border-b border-gray-200 bg-gray-50 px-4">
          {state.carts.map((c) => {
            const on = c.id === cart.id;
            return (
              <div key={c.id} className={cn('flex h-11 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-4 text-sm font-medium', on ? 'border-gray-200 bg-white text-gray-900' : 'border-transparent text-gray-600 hover:bg-gray-100')}>
                <button type="button" role="tab" aria-selected={on} className="max-w-40 truncate" onClick={() => dispatch({ type: 'select', id: c.id })}>
                  {tabLabel(c)}
                  {c.lines.length > 0 && !on && <span className="ml-1 text-xs text-gray-400">({c.lines.length})</span>}
                </button>
                <button
                  type="button"
                  aria-label={`Cerrar ${tabLabel(c)}`}
                  className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  onClick={() => (c.lines.length ? setClosing(c) : dispatch({ type: 'close', id: c.id, priceListId: mainListId }))}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
          <button type="button" aria-label="Nueva venta en paralelo" className="mb-1.5 shrink-0 rounded-md p-2 text-gray-600 hover:bg-gray-100" onClick={() => dispatch({ type: 'newTab', priceListId: mainListId })}>
            <Plus className="size-5" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-5">
          <Segmented
            aria-label="Tipo de operación"
            value={cart.mode}
            onChange={(mode) => dispatch({ type: 'update', patch: { mode } })}
            options={[
              { value: 'sale', label: 'Venta', icon: <Banknote /> },
              { value: 'order', label: 'Pedido', icon: <Truck /> },
            ]}
          />
          <div className="flex gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label="Lista de precios">
                  <CircleDollarSign className="size-5" />
                  {lists.find((l) => l.id === listId)?.name ?? 'Público'}
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                {lists.map((l) => (
                  <DropdownMenuItem key={l.id} onSelect={() => changeList(l.id)} shortcut={l.id === listId ? <Check className="size-4 text-sky-600" /> : null}>
                    {l.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {cart.lines.length > 0 && (
              <Button size="icon" aria-label="Vaciar carrito" onClick={() => dispatch({ type: 'clear' })}>
                <Trash2 />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" aria-label="Opciones de la venta">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-72">
                <DropdownMenuItem role="menuitemcheckbox" aria-checked={cart.taxesRemoved} onSelect={() => dispatch({ type: 'update', patch: { taxesRemoved: !cart.taxesRemoved } })} shortcut={cart.taxesRemoved ? <Check className="size-4 text-sky-600" /> : null}>
                  Quitar Impuestos de la Venta
                </DropdownMenuItem>
                <DropdownMenuItem
                  role="menuitemcheckbox"
                  aria-checked={deferred}
                  disabled={isOrder}
                  onSelect={() => dispatch({ type: 'update', patch: { deferDelivery: !cart.deferDelivery } })}
                  shortcut={deferred ? <Check className="size-4 text-sky-600" /> : null}
                >
                  Posponer Entrega de Productos
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {isOrder && <p className="-mt-2 px-6 pb-3 text-sm text-gray-500">Crea un pedido para envío o retiro posterior</p>}

        {(cart.client || cart.note || cart.taxesRemoved || (cart.deferDelivery && !isOrder)) && (
          <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
            {cart.client && (
              <span className="inline-flex h-8 items-center gap-2 rounded-full bg-sky-50 pl-3 pr-1 text-sm font-medium text-sky-800">
                <User className="size-4" />
                <button type="button" onClick={() => setModal('client')}>
                  {cart.client.name}
                </button>
                <button type="button" aria-label="Quitar cliente" className="rounded-full p-1 hover:bg-sky-100" onClick={() => assignClient(null)}>
                  <X className="size-3.5" />
                </button>
              </span>
            )}
            {cart.note && (
              <button type="button" onClick={() => setModal('note')} className="inline-flex h-8 max-w-xs items-center gap-2 rounded-full bg-green-50 px-3 text-sm text-green-800">
                <StickyNote className="size-4 shrink-0" />
                <span className="truncate">{cart.note}</span>
              </button>
            )}
            {cart.taxesRemoved && <Badge tone="warning">Sin impuestos</Badge>}
            {cart.deferDelivery && !isOrder && <Badge tone="warning">Entrega posterior</Badge>}
          </div>
        )}

        {cart.lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <h3 className="font-display text-2xl font-extrabold text-gray-400">Tu carrito está vacío</h3>
            <p className="mt-2 text-base text-gray-400">Agrega productos a tu {isOrder ? 'pedido' : 'venta'}</p>
            <div className="mt-6 flex gap-6">
              <Button onClick={() => searchRef.current?.focus()}>
                <Search />
                Buscar productos
              </Button>
              <Button onClick={() => searchRef.current?.focus()}>
                <Barcode className="text-indigo-600" />
                ¡Escanea tus productos!
              </Button>
            </div>
          </div>
        ) : (
          <div ref={linesRef} aria-label="Carrito" className="flex-1 space-y-3 overflow-y-auto px-6 pb-4">
            {cart.lines.map((l, i) => (
              <div
                key={l.key}
                onKeyDown={(e) => {
                  if (e.key === 'Delete') {
                    e.preventDefault();
                    dispatch({ type: 'remove', key: l.key });
                    searchRef.current?.focus();
                  }
                }}
              >
                <CartLineRow
                  line={l}
                  index={i}
                  taxesRemoved={cart.taxesRemoved}
                  onQuantity={(quantity) => dispatch({ type: 'line', key: l.key, patch: { quantity } })}
                  onPrice={() => l.productId && setPriceLine(l)}
                  onDiscount={() => setDiscountLine(l)}
                  onRemove={() => dispatch({ type: 'remove', key: l.key })}
                />
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-gray-200 px-6 py-3">
          {cart.lines.length > 0 && (
            <div className="space-y-1 pb-3 text-sm">
              <div className="flex justify-between font-medium text-gray-900">
                <span>Subtotal ({totals.itemCount})</span>
                <span>{money(totals.grossCents)}</span>
              </div>
              {totals.discountCents > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>Descuentos</span>
                  <span>-{money(totals.discountCents)}</span>
                </div>
              )}
              {totals.taxesRemovedCents > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>Impuestos removidos</span>
                  <span>-{money(totals.taxesRemovedCents)}</span>
                </div>
              )}
            </div>
          )}
          <Button variant="primary" size="lg" className="w-full" disabled={!cart.lines.length} onClick={openCheckout}>
            {isOrder ? `Crear Pedido - ${money(totals.totalCents)}` : `Cobrar ${money(totals.totalCents)}`}
            {cart.lines.length > 0 && <Kbd className="border-white/40 bg-transparent text-white">Ctrl ↵</Kbd>}
          </Button>
        </div>
      </section>

      <ManualEntryDialog
        open={modal === 'manual'}
        onOpenChange={(o) => !o && setModal(null)}
        onAdd={(m) =>
          dispatch({
            type: 'add',
            line: {
              productId: null,
              name: m.name,
              sku: null,
              image: null,
              unit: m.unit,
              quantity: m.quantity,
              unitPriceCents: m.unitPriceCents,
              priceListId: null,
              taxRate: m.taxRate,
              discount: null,
              trackStock: false,
              stock: null,
              manual: { costCents: m.costCents, chargeTaxes: m.chargeTaxes, iva: m.iva, ieps: m.ieps },
            },
          })
        }
      />
      <ClientPickerDialog
        open={modal === 'client'}
        onOpenChange={(o) => {
          if (o) return;
          setModal(returnToCheckout ? 'checkout' : null);
          setReturnToCheckout(false);
        }}
        onPick={async (c) => {
          const back = returnToCheckout;
          setReturnToCheckout(false);
          setModal(null);
          await assignClient(c?.id ?? null);
          if (back) setReopenCheckout(true);
        }}
      />
      <NoteDialog open={modal === 'note'} onOpenChange={(o) => !o && setModal(null)} value={cart.note} onSave={(note) => dispatch({ type: 'update', patch: { note } })} />
      <QuickCreateProductDialog
        open={modal === 'create'}
        initialName={createName}
        onOpenChange={(o) => !o && setModal(null)}
        onCreated={async (id) => {
          const p = await db.read((tx) => {
            const d = getProduct(tx, id);
            return d?.sku || d?.barcode ? posFindByCode(tx, (d.barcode ?? d.sku)!, listId) : d ? posSearch(tx, d.name, listId).find((x) => x.id === id) ?? null : null;
          });
          if (p) addProduct(p);
          setTimeout(() => searchRef.current?.focus(), 0);
        }}
      />
      <PriceChoiceDialog
        line={priceLine}
        onClose={() => setPriceLine(null)}
        onChoose={(unitPriceCents, priceListId) => {
          if (priceLine) dispatch({ type: 'line', key: priceLine.key, patch: { unitPriceCents, priceListId } });
          setPriceLine(null);
        }}
      />
      <DiscountDialog
        line={discountLine}
        onClose={() => setDiscountLine(null)}
        onApply={(discount) => {
          if (discountLine) dispatch({ type: 'line', key: discountLine.key, patch: { discount } });
          setDiscountLine(null);
        }}
      />
      <ConfirmDialog
        open={!!closing}
        onOpenChange={(o) => !o && setClosing(null)}
        title="Cerrar venta en curso"
        description={closing ? `"${tabLabel(closing)}" tiene ${closing.lines.length} ${closing.lines.length === 1 ? 'producto' : 'productos'} sin cobrar. Se descartará el carrito.` : ''}
        confirmLabel="Cerrar Venta"
        onConfirm={() => {
          if (closing) dispatch({ type: 'close', id: closing.id, priceListId: mainListId });
        }}
      />
      {checkoutCart && (
        <CheckoutDialog
          cart={checkoutCart}
          open={modal === 'checkout'}
          onOpenChange={(o) => {
            if (!o) {
              setModal(null);
              setCheckoutCart(null);
            }
          }}
          onAssignClient={() => {
            setReturnToCheckout(true);
            setModal('client');
          }}
          onCompleted={(r) => dispatch({ type: 'finish', id: r.id, priceListId: mainListId })}
          onFinished={() => {
            setModal(null);
            setCheckoutCart(null);
            setTimeout(() => searchRef.current?.focus(), 0);
          }}
          onPrint={(id) => printSaleTicket(db.read.bind(db), id, { checkout: true }).catch((e) => toast.error(e))}
        />
      )}
    </div>
  );
}
