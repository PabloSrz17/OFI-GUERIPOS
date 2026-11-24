import * as React from 'react';
import { CircleDollarSign, Plus, Search, User, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, InputGroup, Textarea } from '@/components/ui/input';
import { Kbd, Thumb } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { ClientDialog } from '@/components/clients/ClientDialogs';
import { useLiveQuery } from '@/db/hooks';
import { IEPS_OPTIONS, IVA_OPTIONS, parseMoneyToCents, parseQuantity, taxRate, unitById, UNITS } from '@/domain/catalog';
import type { LineDiscount } from '@/domain/sale';
import { listPriceLists } from '@/repos/categories';
import { clientName, clientPhone, listClients } from '@/repos/clients';
import { productPriceMap } from '@/repos/sales';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CartLine } from '@/pos/cart-store';

const money = (c: number) => formatMoney(c / 100);

function LineCard({ line }: { line: CartLine }) {
  return (
    <div className="flex items-center gap-4 rounded-lg bg-white p-4 shadow-card">
      <Thumb src={line.image ?? undefined} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-gray-900">{line.name}</p>
        <p className="text-sm text-gray-500">{money(line.unitPriceCents)}</p>
      </div>
    </div>
  );
}

// ---------- Elige la Lista de Precios (C-pos-line-price.png) ----------

export function PriceChoiceDialog({ line, onClose, onChoose }: { line: CartLine | null; onClose: () => void; onChoose: (priceCents: number, priceListId: string | null) => void }) {
  const lists = useLiveQuery(listPriceLists, []) ?? [];
  const prices = useLiveQuery((tx) => (line?.productId ? productPriceMap(tx, [line.productId])[line.productId] ?? {} : {}), [line?.productId]) ?? {};
  const [custom, setCustom] = React.useState<string | null>(null);
  React.useEffect(() => setCustom(null), [line?.key]);
  const options = lists.filter((l) => prices[l.id] !== undefined);
  const row = 'flex w-full items-center gap-4 rounded-lg px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none';
  const icon = (
    <span className="flex size-11 items-center justify-center rounded-full bg-violet-50 text-violet-600">
      <CircleDollarSign className="size-5" />
    </span>
  );
  return (
    <Dialog open={!!line} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Elige la Lista de Precios" size="md" bodyClassName="px-2 py-2">
        {custom === null ? (
          <div className="space-y-1">
            {options.map((l) => (
              <button key={l.id} type="button" className={cn(row, line?.priceListId === l.id && 'bg-gray-50')} onClick={() => onChoose(prices[l.id], l.id)}>
                {icon}
                <span className="flex-1">{l.name}</span>
                <span className="text-base text-gray-900">{money(prices[l.id])}</span>
              </button>
            ))}
            <button type="button" className={cn(row, line?.priceListId === null && 'bg-gray-50')} onClick={() => setCustom(line ? (line.unitPriceCents / 100).toFixed(2) : '')}>
              {icon}
              <span className="flex-1">Precio Personalizado</span>
            </button>
          </div>
        ) : (
          <form
            className="space-y-4 px-4 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              onChoose(parseMoneyToCents(custom), null);
            }}
          >
            <Field label="Precio Personalizado" htmlFor="pos-custom-price">
              <InputGroup id="pos-custom-price" type="number" min={0} step="0.01" inputMode="decimal" prefix="$" suffix={`por ${unitById(line?.unit).label}`} value={custom} onChange={(e) => setCustom(e.target.value)} autoFocus />
            </Field>
            <div className="flex justify-end gap-4">
              <Button onClick={() => setCustom(null)}>Regresar</Button>
              <Button type="submit" variant="primary" disabled={custom.trim() === ''}>
                Aplicar Precio
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Añadir Descuento (C-pos-line-discount.png) ----------

export function DiscountDialog({ line, onClose, onApply }: { line: CartLine | null; onClose: () => void; onApply: (d: LineDiscount | null) => void }) {
  const [type, setType] = React.useState<'amount' | 'percent'>('amount');
  const [value, setValue] = React.useState('');
  const [label, setLabel] = React.useState('');
  React.useEffect(() => {
    if (!line) return;
    setType(line.discount?.type ?? 'amount');
    setValue(line.discount ? String(line.discount.type === 'amount' ? (line.discount.value / 100).toFixed(2) : line.discount.value) : '');
    setLabel(line.discount?.label ?? '');
  }, [line]);
  const num = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(num) && num > 0 && (type === 'amount' || num <= 100);
  const apply = () => valid && onApply({ type, value: type === 'amount' ? parseMoneyToCents(value) : num, label: label.trim() || null });
  return (
    <Dialog open={!!line} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Añadir Descuento"
        size="md"
        bodyClassName="p-0"
        footer={
          <>
            {line?.discount && (
              <Button className="mr-auto text-red-700" onClick={() => onApply(null)}>
                Quitar Descuento
              </Button>
            )}
            <DialogClose asChild>
              <Button>Cancelar</Button>
            </DialogClose>
            <Button variant="primary" disabled={!valid} onClick={apply}>
              Añadir
            </Button>
          </>
        }
      >
        {line && (
          <div className="bg-gray-100 p-6">
            <LineCard line={line} />
          </div>
        )}
        <form
          className="space-y-5 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <Segmented
            aria-label="Tipo de descuento"
            fullWidth
            value={type}
            onChange={setType}
            options={[
              { value: 'amount', label: 'Cantidad ($)' },
              { value: 'percent', label: 'Porcentaje (%)' },
            ]}
          />
          <Field label="Cantidad del Descuento" htmlFor="pos-discount">
            <InputGroup id="pos-discount" type="number" min={0} step="0.01" inputMode="decimal" prefix={type === 'amount' ? '$' : '%'} placeholder="0.00" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </Field>
          <Field label="Título del Descuento (opcional)" htmlFor="pos-discount-title">
            <Input id="pos-discount-title" placeholder="Ej: Promo20" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Añadir Cliente (C-pos-add-client.png) ----------

export interface PickedClient {
  id: string;
  name: string;
  priceListId: string | null;
}

export function ClientPickerDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (c: PickedClient | null) => void }) {
  const [q, setQ] = React.useState('');
  const [index, setIndex] = React.useState(0);
  const [creating, setCreating] = React.useState(false);
  const result = useLiveQuery((tx) => listClients(tx, { q, pageSize: 50 }), [q]);
  const rows = result?.rows ?? [];
  // Índice 0 = "Público en General" (sin cliente).
  const count = rows.length + 1;
  React.useEffect(() => {
    if (open) {
      setQ('');
      setIndex(0);
    }
  }, [open]);
  React.useEffect(() => setIndex(q ? 1 : 0), [q]);
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const pickIndex = (i: number) => {
    if (i === 0) return onPick(null);
    const c = rows[i - 1];
    if (c) onPick({ id: c.id, name: clientName(c), priceListId: null });
  };

  const item = 'flex w-full items-center gap-4 rounded-lg px-3 py-2.5 text-left text-sm text-gray-900';
  return (
    <>
      <Dialog open={open && !creating} onOpenChange={onOpenChange}>
        <DialogContent
          title="Añadir Cliente"
          size="lg"
          className="max-w-[610px]"
          bodyClassName="flex flex-col px-6 pb-0 pt-6"
          beforeFooter={
            <div className="flex justify-between px-2 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> Navegar
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> Confirmar
              </span>
            </div>
          }
        >
          <InputGroup
            icon={<Search />}
            aria-label="Buscar cliente"
            placeholder="Buscar por nombre, teléfono o email"
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(count - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pickIndex(index);
              }
            }}
          />
          <button type="button" className="mt-2 flex items-center gap-2 border-b border-gray-200 px-6 py-4 text-sm font-medium text-sky-600 hover:text-sky-700" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Nuevo cliente
          </button>
          <div ref={listRef} role="listbox" aria-label="Clientes" className="-mx-1 max-h-[330px] overflow-y-auto px-1 py-2">
            <button type="button" role="option" aria-selected={index === 0} data-index={0} className={cn(item, index === 0 && 'bg-gray-50')} onMouseEnter={() => setIndex(0)} onClick={() => pickIndex(0)}>
              <span className="flex size-12 items-center justify-center rounded-full bg-sky-50 text-sky-700">
                <Users className="size-5" />
              </span>
              Público en General
            </button>
            {rows.map((c, i) => (
              <button key={c.id} type="button" role="option" aria-selected={index === i + 1} data-index={i + 1} className={cn(item, index === i + 1 && 'bg-gray-50')} onMouseEnter={() => setIndex(i + 1)} onClick={() => pickIndex(i + 1)}>
                <span className="flex size-12 items-center justify-center rounded-full bg-sky-50 text-sky-700">
                  <User className="size-5" />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {clientName(c)} {c.phone && <span className="text-gray-500">{clientPhone(c)}</span>}
                </span>
                {c.debt_cents > 0 && <span className="text-xs text-pink-700">Debe {money(c.debt_cents)}</span>}
              </button>
            ))}
            {q && rows.length === 0 && <p className="px-3 py-6 text-center text-sm text-gray-500">No se encontraron clientes para esta búsqueda</p>}
          </div>
        </DialogContent>
      </Dialog>
      <ClientDialog
        open={creating}
        initialName={q}
        onOpenChange={(o) => !o && setCreating(false)}
        onSaved={(id) => {
          setCreating(false);
          onPick({ id, name: '', priceListId: null });
        }}
      />
    </>
  );
}

// ---------- Entrada Manual de Producto (C-pos-manual-entry.png) ----------

export interface ManualLine {
  name: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  costCents: number;
  chargeTaxes: boolean;
  iva: string;
  ieps: string;
  taxRate: number;
}

export function ManualEntryDialog({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; onAdd: (l: ManualLine) => void }) {
  const empty = { name: '', quantity: '1', unit: 'unit', price: '', cost: '', chargeTaxes: true, iva: '16', ieps: 'none' };
  const [f, setF] = React.useState(empty);
  React.useEffect(() => {
    if (open) setF(empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const qty = parseQuantity(f.quantity);
  const valid = f.name.trim() !== '' && qty > 0 && f.price.trim() !== '' && parseMoneyToCents(f.price) >= 0;
  const unit = unitById(f.unit);
  const submit = () => {
    if (!valid) return;
    onAdd({
      name: f.name.trim(),
      quantity: qty,
      unit: f.unit,
      unitPriceCents: parseMoneyToCents(f.price),
      costCents: parseMoneyToCents(f.cost),
      chargeTaxes: f.chargeTaxes,
      iva: f.iva,
      ieps: f.ieps,
      taxRate: taxRate({ chargeTaxes: f.chargeTaxes, iva: f.iva, ieps: f.ieps }),
    });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Entrada Manual de Producto"
        description="Añade un producto al carrito sin agregarlo a tu inventario"
        size="lg"
        className="max-w-[596px]"
        bodyTone="gray"
        bodyClassName="space-y-4"
        footer={
          <>
            <DialogClose asChild>
              <Button>Cancelar</Button>
            </DialogClose>
            <Button variant="primary" disabled={!valid} onClick={submit}>
              Crear y Agregar
            </Button>
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-lg bg-white p-6 shadow-card">
            <Field label="Nombre del producto" htmlFor="me-name" className="col-span-2">
              <Input id="me-name" placeholder="Ej. Jabón de mano" value={f.name} autoFocus onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label="Cantidad" htmlFor="me-qty">
              <Input id="me-qty" type="number" min={0} step="any" inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
            </Field>
            <Field label="Unidad de Venta" htmlFor="me-unit">
              <Select id="me-unit" aria-label="Unidad de Venta" className="w-full" value={f.unit} onValueChange={(v) => setF({ ...f, unit: v })} options={UNITS.map((u) => ({ value: u.id, label: u.label }))} />
            </Field>
            <Field label="Precio de Venta" htmlFor="me-price">
              <InputGroup id="me-price" type="number" min={0} step="0.01" inputMode="decimal" prefix="$" placeholder="0.00" suffix={`por ${unit.label}`} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
            </Field>
            <Field label="Costo (opcional)" htmlFor="me-cost">
              <InputGroup id="me-cost" type="number" min={0} step="0.01" inputMode="decimal" prefix="$" placeholder="0.00" suffix={`por ${unit.label}`} value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
            </Field>
          </div>
          <div className="space-y-5 rounded-lg bg-white p-6 shadow-card">
            <CheckboxField id="me-taxes" label="Cobrar impuestos del producto" checked={f.chargeTaxes} onCheckedChange={(v) => setF({ ...f, chargeTaxes: v === true })} />
            {f.chargeTaxes && (
              <div className="grid grid-cols-2 gap-6">
                <Field label="IVA">
                  <Select aria-label="IVA" className="w-full" value={f.iva} onValueChange={(v) => setF({ ...f, iva: v })} options={IVA_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
                </Field>
                <Field label="IEPS">
                  <Select aria-label="IEPS" className="w-full" value={f.ieps} onValueChange={(v) => setF({ ...f, ieps: v })} options={IEPS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
                </Field>
              </div>
            )}
          </div>
          <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Añadir Nota (C-pos-add-note.png) ----------

export function NoteDialog({ open, onOpenChange, value, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; value: string; onSave: (v: string) => void }) {
  const [text, setText] = React.useState(value);
  React.useEffect(() => {
    if (open) setText(value);
  }, [open, value]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Añadir Nota"
        size="md"
        footer={
          <>
            <DialogClose asChild>
              <Button>Cancelar</Button>
            </DialogClose>
            <Button
              variant="primary"
              onClick={() => {
                onSave(text.trim());
                onOpenChange(false);
              }}
            >
              Añadir
            </Button>
          </>
        }
      >
        <Field label="Nota" htmlFor="pos-note" help="Se mostrará a tus clientes en los comprobantes">
          <Textarea id="pos-note" rows={4} placeholder="Escribe una nota para esta venta" value={text} autoFocus onChange={(e) => setText(e.target.value)} />
        </Field>
      </DialogContent>
    </Dialog>
  );
}

