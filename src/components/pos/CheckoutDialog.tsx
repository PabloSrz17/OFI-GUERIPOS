import * as React from 'react';
import { AlertTriangle, ArrowLeftRight, Banknote, CalendarClock, CheckCircle2, CreditCard, Printer, UserPlus, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { InputGroup } from '@/components/ui/input';
import { Kbd } from '@/components/ui/misc';
import { useDb, useLiveQuery } from '@/db/hooks';
import { parseMoneyToCents } from '@/domain/catalog';
import { cashSuggestions, changeFor, PAYMENT_METHODS, saleFolio, type PaymentMethod } from '@/domain/sale';
import { effectiveCreditLimit, getClient } from '@/repos/clients';
import { ValidationError } from '@/repos/common';
import { clientDebtCents, createSale, CREDIT_DAYS_KEY, DEFAULT_CREDIT_DAYS } from '@/repos/sales';
import { getSetting } from '@/repos/settings';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { cartToSaleInput, cartTotals, type Cart } from '@/pos/cart-store';

const money = (c: number) => formatMoney(c / 100);

const ICONS: Record<PaymentMethod, React.ReactNode> = {
  cash: <Banknote />,
  credit_card: <CreditCard />,
  debit_card: <WalletCards />,
  transfer: <ArrowLeftRight />,
  credit: <CalendarClock />,
};

export interface CheckoutResult {
  id: string;
  folio: number;
  changeCents: number;
  method: PaymentMethod;
}

interface Props {
  cart: Cart;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAssignClient: () => void;
  /** La venta ya quedó guardada: el carrito se puede descartar. */
  onCompleted: (r: CheckoutResult) => void;
  /** El usuario cerró la pantalla de éxito. */
  onFinished: () => void;
  onPrint: (saleId: string) => void;
}

/**
 * Cobro de la venta (diseño propio, decisions.md D1: la pantalla de Pulpos no se observó).
 * Un solo método de pago por venta (D12). Métodos tomados del historial y la caja de Pulpos.
 */
export function CheckoutDialog({ cart, open, onOpenChange, onAssignClient, onCompleted, onFinished, onPrint }: Props) {
  const db = useDb();
  const totals = cartTotals(cart);
  const total = totals.totalCents;
  const [method, setMethod] = React.useState<PaymentMethod>('cash');
  const [received, setReceived] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<CheckoutResult | null>(null);
  const receivedRef = React.useRef<HTMLInputElement>(null);
  const newSaleRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (open) {
      setMethod('cash');
      setReceived('');
      setError(null);
      setDone(null);
    }
  }, [open]);

  const credit = useLiveQuery(
    (tx) => {
      if (!cart.client) return null;
      const c = getClient(tx, cart.client.id);
      if (!c) return null;
      return { limit: effectiveCreditLimit(tx, c), debt: clientDebtCents(tx, c.id), days: getSetting(tx, CREDIT_DAYS_KEY, DEFAULT_CREDIT_DAYS) };
    },
    [cart.client?.id],
  );

  const receivedCents = received.trim() === '' ? total : parseMoneyToCents(received);
  const change = method === 'cash' ? changeFor(total, receivedCents) : 0;
  const available = credit && credit.limit !== null ? credit.limit - credit.debt : null;
  const creditBlocked = method === 'credit' && (!cart.client || (available !== null && total > available));
  const canPay = !busy && !done && (method !== 'cash' || change !== null) && !creditBlocked;

  async function pay() {
    if (!canPay) return;
    setBusy(true);
    setError(null);
    try {
      const r = await db.write((tx) => createSale(tx, cartToSaleInput(cart, { method, receivedCents: method === 'cash' ? receivedCents : null })));
      const result = { id: r.id, folio: r.folio, changeCents: r.changeCents, method };
      setDone(result);
      onCompleted(result);
      setTimeout(() => newSaleRef.current?.focus(), 0);
    } catch (e) {
      setError(e instanceof ValidationError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const close = (o: boolean) => {
    if (o) return;
    if (done) onFinished();
    else onOpenChange(false);
  };

  const label = cart.mode === 'order' ? 'Pedido' : 'Venta';

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title={done ? `${label} registrada` : `Cobrar ${label}`}
        size="lg"
        bodyTone="gray"
        bodyClassName="space-y-4"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          receivedRef.current?.focus();
        }}
        onKeyDown={(e) => {
          if (!done && e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            pay();
          }
          if (!done && e.altKey && /^[1-5]$/.test(e.key)) {
            e.preventDefault();
            setMethod(PAYMENT_METHODS[Number(e.key) - 1].value);
          }
        }}
        footer={
          done ? (
            <>
              <Button onClick={() => onPrint(done.id)}>
                <Printer />
                Imprimir Ticket
              </Button>
              <Button ref={newSaleRef} variant="primary" onClick={onFinished}>
                Nueva Venta
              </Button>
            </>
          ) : (
            <>
              <DialogClose asChild>
                <Button>Cancelar</Button>
              </DialogClose>
              <Button variant="primary" disabled={!canPay} onClick={pay} className="min-w-44">
                {busy ? 'Registrando…' : method === 'credit' ? `Vender a Crédito ${money(total)}` : `Cobrar ${money(total)}`}
                <Kbd className="border-white/40 bg-transparent text-white">Ctrl ↵</Kbd>
              </Button>
            </>
          )
        }
      >
        {done ? (
          <div className="flex flex-col items-center rounded-lg bg-white px-6 py-10 text-center shadow-card">
            <CheckCircle2 className="size-14 text-green-500" />
            <p className="mt-4 text-lg font-medium text-gray-900">
              {label} {saleFolio(done.folio)} registrada
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {done.method === 'credit' ? `${money(total)} a crédito de ${cart.client?.name}` : `Cobro de ${money(total)} en ${PAYMENT_METHODS.find((m) => m.value === done.method)!.label}`}
            </p>
            {done.method === 'cash' && (
              <div className="mt-6">
                <p className="text-sm text-gray-600">Cambio</p>
                <p data-testid="change" className="font-display text-4xl font-extrabold text-gray-900">
                  {money(done.changeCents)}
                </p>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-end justify-between rounded-lg bg-white p-6 shadow-card">
              <div>
                <p className="text-sm text-gray-600">Total a cobrar</p>
                <p data-testid="checkout-total" className="font-display text-3xl font-extrabold text-gray-900">
                  {money(total)}
                </p>
              </div>
              <div className="text-right text-sm text-gray-500">
                <p>
                  {totals.itemCount} {totals.itemCount === 1 ? 'producto' : 'productos'}
                </p>
                <p>{cart.client ? cart.client.name : 'Público en General'}</p>
              </div>
            </div>

            <div className="rounded-lg bg-white p-6 shadow-card">
              <h5 className="mb-4 text-sm font-semibold text-gray-900">Método de Pago</h5>
              <div role="radiogroup" aria-label="Método de pago" className="grid grid-cols-5 gap-2">
                {PAYMENT_METHODS.map((m, i) => {
                  const active = m.value === method;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      title={`Alt ${i + 1}`}
                      onClick={() => {
                        setMethod(m.value);
                        setError(null);
                        if (m.value === 'cash') setTimeout(() => receivedRef.current?.focus(), 0);
                      }}
                      className={cn(
                        'flex h-[84px] flex-col items-center justify-center gap-2 rounded-lg px-1 text-center text-xs font-medium leading-tight text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [&_svg]:size-5',
                        active ? 'bg-sky-50 text-sky-800 ring-2 ring-sky-600' : 'ring-1 ring-gray-200 hover:bg-gray-50',
                      )}
                    >
                      {ICONS[m.value]}
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {method === 'cash' && (
              <div className="space-y-4 rounded-lg bg-white p-6 shadow-card">
                <Field label="Efectivo recibido" htmlFor="co-received" error={change === null ? `Faltan ${money(total - receivedCents)}` : null}>
                  <InputGroup
                    ref={receivedRef}
                    id="co-received"
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    prefix="$"
                    placeholder={(total / 100).toFixed(2)}
                    value={received}
                    aria-invalid={change === null}
                    onChange={(e) => setReceived(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.ctrlKey) {
                        e.preventDefault();
                        pay();
                      }
                    }}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  {cashSuggestions(total).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setReceived((v / 100).toFixed(2))}
                      className={cn('h-8 rounded-full border px-3 text-sm font-medium', receivedCents === v && received !== '' ? 'border-sky-600 bg-sky-50 text-sky-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50')}
                    >
                      {v === total ? 'Exacto' : money(v)}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t border-gray-200 pt-4">
                  <span className="text-sm text-gray-600">Cambio</span>
                  <span className="text-2xl font-semibold text-gray-900">{change === null ? '—' : money(change)}</span>
                </div>
              </div>
            )}

            {(method === 'credit_card' || method === 'debit_card' || method === 'transfer') && (
              <div className="rounded-lg bg-white p-6 text-sm text-gray-600 shadow-card">
                {method === 'transfer' ? 'Verifica que la transferencia se haya recibido antes de registrar el cobro.' : 'Cobra en la terminal bancaria y registra la venta cuando el pago sea aprobado.'}
              </div>
            )}

            {method === 'credit' && (
              <div className="rounded-lg bg-white p-6 shadow-card">
                {!cart.client ? (
                  <div className="flex items-center justify-between gap-4">
                    <p className="flex items-center gap-2 text-sm text-gray-700">
                      <AlertTriangle className="size-5 text-amber-500" />
                      Para vender a crédito asigna un cliente a la venta.
                    </p>
                    <Button onClick={onAssignClient}>
                      <UserPlus />
                      Asignar Cliente
                    </Button>
                  </div>
                ) : (
                  credit && (
                    <dl className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-gray-600">Cliente</dt>
                        <dd className="font-medium text-gray-900">{cart.client.name}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-600">Deuda actual</dt>
                        <dd className="text-gray-900">{money(credit.debt)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-600">Límite de crédito</dt>
                        <dd className="text-gray-900">{credit.limit === null ? 'Sin limitar' : money(credit.limit)}</dd>
                      </div>
                      {available !== null && (
                        <div className="flex justify-between">
                          <dt className="text-gray-600">Disponible</dt>
                          <dd className={cn('font-medium', total > available ? 'text-red-700' : 'text-gray-900')}>{money(Math.max(0, available))}</dd>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-gray-200 pt-3">
                        <dt className="text-gray-600">Vence</dt>
                        <dd className="text-gray-900">En {credit.days} días</dd>
                      </div>
                      {available !== null && total > available && <p className="rounded-md bg-red-50 px-3 py-2 text-red-800">La venta excede el crédito disponible del cliente.</p>}
                    </dl>
                  )
                )}
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
