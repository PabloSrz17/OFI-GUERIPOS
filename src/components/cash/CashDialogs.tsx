import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, ArrowUp, Banknote, Calculator, CreditCard } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, InputGroup } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/feedback';
import { useDb } from '@/db/hooks';
import type { CashMethod } from '@/domain/sale';
import { paymentMethodLabel, saleFolio } from '@/domain/sale';
import { formatMoney, formatRelativeDateTime } from '@/lib/format';
import { uuid } from '@/lib/uuid';
import { cn } from '@/lib/utils';
import { addCashFlow, type CashMovementRow, type ExpectedBreakdown } from '@/repos/cash';
import { CURRENT_USER } from '@/repos/common';

export const money = (cents: number, signed = false) => formatMoney(cents / 100, { signed });

/** Ícono y color de cada método, como en "Total Esperado" (G-cash-current.png). */
const METHOD_ICON: Record<CashMethod | 'total', { icon: React.ElementType; className: string }> = {
  cash: { icon: Banknote, className: 'text-sky-500' },
  credit_card: { icon: CreditCard, className: 'text-amber-700' },
  debit_card: { icon: CreditCard, className: 'text-violet-600' },
  transfer: { icon: ArrowRight, className: 'text-amber-600' },
  total: { icon: Calculator, className: 'text-gray-900' },
};

export function MethodIcon({ method }: { method: CashMethod | 'total' }) {
  const { icon: Icon, className } = METHOD_ICON[method];
  return <Icon aria-hidden="true" className={cn('size-5 shrink-0', className)} />;
}

/** Pill del tipo de movimiento (Ingreso verde / Retiro rojo). */
export function FlowBadge({ type }: { type: string }) {
  return type === 'cash_in' ? <Badge tone="success">Ingreso</Badge> : <Badge tone="danger">Retiro</Badge>;
}

/** "Faltan $5.00" / "Sobran $5.00" / "Sin diferencia". */
export function DifferenceBadge({ cents }: { cents: number }) {
  if (cents === 0) return <Badge tone="success">Sin diferencia</Badge>;
  return cents < 0 ? <Badge tone="danger">Faltan {money(-cents)}</Badge> : <Badge tone="warning">Sobran {money(cents)}</Badge>;
}

/** Pesos escritos ("150.5") → centavos; null si no es un número válido. */
export function parsePesos(text: string) {
  const t = text.trim().replace(/,/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** "Ingresar Efectivo a Caja" / "Retirar Efectivo de Caja" (G-cash-in-modal.png, G-cash-out-modal.png). */
export function CashFlowDialog({ type, open, onOpenChange, cashExpected }: { type: 'cash_in' | 'cash_out'; open: boolean; onOpenChange: (o: boolean) => void; cashExpected: number }) {
  const db = useDb();
  const toast = useToast();
  const [amount, setAmount] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  // Un id por apertura: un doble clic en Confirmar no registra dos veces.
  const idRef = React.useRef(uuid());
  React.useEffect(() => {
    if (open) {
      setAmount('');
      setReason('');
      idRef.current = uuid();
    }
  }, [open]);
  const cents = parsePesos(amount);
  const valid = cents !== null && cents > 0;
  const isIn = type === 'cash_in';
  const confirm = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await db.write((tx) => addCashFlow(tx, { id: idRef.current, type, amountCents: cents, reason }));
      toast.success(isIn ? 'Ingreso registrado' : 'Retiro registrado');
      onOpenChange(false);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isIn ? 'Ingresar Efectivo a Caja' : 'Retirar Efectivo de Caja'}
        size="md"
        footer={
          <>
            <DialogClose asChild>
              <Button>Cancelar</Button>
            </DialogClose>
            <Button variant="primary" disabled={!valid || busy} onClick={confirm}>
              Confirmar
            </Button>
          </>
        }
      >
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
        >
          <Field label="Monto" htmlFor="cash-amount" help={!isIn && valid && cents! > cashExpected ? `El efectivo esperado en caja es ${money(cashExpected)}; quedará en negativo.` : undefined}>
            <InputGroup id="cash-amount" type="number" inputMode="decimal" min={0} step="0.01" prefix="$" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <Field label={<>Motivo<span className="font-normal text-gray-400">(opcional)</span></>} htmlFor="cash-reason">
            <Input id="cash-reason" placeholder={isIn ? 'Ej: Reposición de billetes' : 'Ej. Pago de luz'} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div>
            <p className="text-sm font-medium text-gray-800">Realizado por</p>
            <p className="mt-1.5 text-sm text-gray-700">{CURRENT_USER}</p>
          </div>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}

const SUMMARY_ROWS: { key: keyof Omit<ExpectedBreakdown, 'method' | 'expected'>; label: string; cashOnly?: boolean }[] = [
  { key: 'start', label: 'al inicio', cashOnly: true },
  { key: 'sales', label: 'Ventas' },
  { key: 'collections', label: 'Cobros de Crédito' },
  { key: 'cashIn', label: 'Ingresos', cashOnly: true },
  { key: 'cashOut', label: 'Retiros', cashOnly: true },
  { key: 'deletions', label: 'Ventas Eliminadas' },
];

/** Cada movimiento con su origen: enlace a la venta si viene de un pago. */
export function MovementList({ movements, showMethod }: { movements: CashMovementRow[]; showMethod?: boolean }) {
  if (movements.length === 0) return <EmptyState muted title="Sin movimientos" />;
  return (
    <ul className="divide-y divide-gray-200">
      {movements.map((m) => (
        <li key={m.id} className="flex items-start justify-between gap-4 py-3 text-sm">
          <div className="min-w-0">
            <p className="text-gray-900">
              {m.sale_id && m.sale_folio !== null ? (
                <>
                  {m.type === 'sale_deletion' ? 'Eliminación de ' : m.type === 'collection' ? 'Cobro de Deuda en ' : ''}
                  <Link to={`/sales/detail?id=${m.sale_id}`} className="font-medium text-sky-600 hover:text-sky-700">
                    Venta {saleFolio(m.sale_folio)}
                  </Link>
                </>
              ) : (
                m.description
              )}
            </p>
            <p className="text-gray-500">
              {formatRelativeDateTime(new Date(m.created_at))} · {m.user_name}
              {showMethod && ` · ${paymentMethodLabel(m.method)}`}
            </p>
          </div>
          <span className={cn('whitespace-nowrap font-medium', m.amount_cents < 0 ? 'text-red-700' : 'text-green-700')}>{money(m.amount_cents, true)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Total Esperado en Efectivo" (G-cash-expected-breakdown.png): Resumen por concepto y Detalle de Movimientos.
 * "Devoluciones" y "Compras y Gastos" de Pulpos se omiten (D18, D8); "Ventas Eliminadas" es propio.
 */
export function ExpectedDialog({ breakdown, movements, open, onOpenChange }: { breakdown: ExpectedBreakdown | null; movements: CashMovementRow[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [tab, setTab] = React.useState<'summary' | 'detail'>('summary');
  React.useEffect(() => {
    if (open) setTab('summary');
  }, [open]);
  if (!breakdown) return null;
  const label = paymentMethodLabel(breakdown.method);
  const rows = SUMMARY_ROWS.filter((r) => !r.cashOnly || breakdown.method === 'cash');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={
          <>
            Total Esperado <span className="text-base text-gray-500">en {label}</span>
          </>
        }
        size="md"
        bodyClassName="px-6 pt-3 pb-0"
        footer={
          <div className="flex w-full items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-sky-50">
              <MethodIcon method="total" />
            </span>
            <span className="flex-1 text-xl font-medium text-gray-900">Total Esperado</span>
            <span className="text-xl font-medium text-gray-900" data-testid="expected-total">
              {money(breakdown.expected)}
            </span>
          </div>
        }
      >
        <Segmented
          fullWidth
          aria-label="Vista"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'summary', label: 'Resumen' },
            { value: 'detail', label: 'Detalle de Movimientos' },
          ]}
        />
        {tab === 'summary' ? (
          <ul className="py-2">
            {rows.map((r) => {
              const v = breakdown[r.key];
              const down = r.key === 'cashOut' || r.key === 'deletions';
              return (
                <li key={r.key} className="flex items-center gap-3 py-3">
                  <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', down ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700')}>
                    {down ? <ArrowDown className="size-5" /> : <ArrowUp className="size-5" />}
                  </span>
                  <span className="flex-1 text-sm">
                    {r.key === 'start' ? (
                      <span className="font-medium text-gray-900">{label} al inicio</span>
                    ) : (
                      <>
                        <span className="block font-medium text-gray-900">{r.label}</span>
                        <span className="text-gray-500">En {label}</span>
                      </>
                    )}
                  </span>
                  <span className={cn('text-sm font-medium', down ? 'text-red-700' : 'text-green-700')}>{r.key === 'start' ? money(v) : down ? `-${money(Math.abs(v))}` : `+${money(v)}`}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="py-2">
            <MovementList movements={movements} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "Ver Movimientos" del corte: todos sus movimientos, de todos los métodos. */
export function MovementsDialog({ movements, open, onOpenChange }: { movements: CashMovementRow[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Movimientos del Corte" size="lg" bodyClassName="py-2">
        <MovementList movements={movements} showMethod />
      </DialogContent>
    </Dialog>
  );
}
