import * as React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, MoreHorizontal, Printer, ReceiptText, User, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field } from '@/components/ui/field';
import { InputGroup } from '@/components/ui/input';
import { ConfirmDialog, useToast } from '@/components/ui/feedback';
import { MethodIcon, money, parsePesos } from '@/components/cash/CashDialogs';
import { printCollectionTicket } from '@/collections/collection-ticket';
import { useDb, useLiveQuery } from '@/db/hooks';
import { dueText, paymentMethodLabel, saleFolio, type CashMethod } from '@/domain/sale';
import { formatRelativeDateTime } from '@/lib/format';
import { uuid } from '@/lib/uuid';
import { cn } from '@/lib/utils';
import { CASH_METHODS } from '@/repos/cash';
import { cancelCollection, clientDebtSummary, createCollection, planCollection, type CollectionRow } from '@/repos/collections';

export interface CollectTarget {
  clientId?: string | null;
  saleId?: string | null;
}

/**
 * Registrar Cobro (diseño propio, D23: en Pulpos no se abrió). Monto (todo lo que se debe por defecto),
 * método, efectivo recibido y cambio, y cómo se reparte entre las ventas. Al confirmar muestra el resultado
 * con Imprimir Ticket.
 */
export function CollectDialog({ open, onOpenChange, target, clientName }: { open: boolean; onOpenChange: (o: boolean) => void; target: CollectTarget; clientName?: string | null }) {
  const db = useDb();
  const toast = useToast();
  const idRef = React.useRef(uuid());
  const [amount, setAmount] = React.useState('');
  const [method, setMethod] = React.useState<CashMethod>('cash');
  const [received, setReceived] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<null | { id: string; folio: number; changeCents: number; amount: number }>(null);

  const debt = useLiveQuery((tx) => planCollection(tx, target, Number.MAX_SAFE_INTEGER).reduce((a, p) => a + p.balanceBefore, 0), [target.clientId, target.saleId]);
  React.useEffect(() => {
    if (open) {
      idRef.current = uuid();
      setMethod('cash');
      setReceived('');
      setDone(null);
      setAmount('');
    }
  }, [open]);
  // El monto arranca con toda la deuda en cuanto se conoce.
  React.useEffect(() => {
    if (open && !done && amount === '' && debt) setAmount((debt / 100).toFixed(2));
  }, [open, debt]); // eslint-disable-line react-hooks/exhaustive-deps

  const cents = parsePesos(amount);
  const plan = useLiveQuery((tx) => (cents && cents > 0 ? planCollection(tx, target, cents) : []), [target.clientId, target.saleId, cents]) ?? [];
  const receivedCents = method === 'cash' ? (parsePesos(received) ?? cents) : null;
  const tooMuch = cents !== null && debt !== undefined && cents > debt;
  const short = method === 'cash' && cents !== null && receivedCents !== null && receivedCents < cents;
  const valid = cents !== null && cents > 0 && !tooMuch && !short && !!debt;

  const confirm = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const r = await db.write((tx) => createCollection(tx, { id: idRef.current, ...target, amountCents: cents!, method, receivedCents }));
      setDone({ ...r, amount: cents! });
      toast.success(`Cobro de ${money(cents!)} registrado`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const print = () => printCollectionTicket(db.read.bind(db), done!.id).catch((e) => toast.error(e));

  if (done)
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          title="Registrar Cobro"
          size="md"
          footer={
            <>
              <Button onClick={print}>
                <Printer />
                Imprimir Ticket
              </Button>
              <DialogClose asChild>
                <Button variant="primary">Listo</Button>
              </DialogClose>
            </>
          }
        >
          <div className="flex flex-col items-center py-4 text-center">
            <CheckCircle2 className="size-12 text-green-600" />
            <p className="mt-3 text-lg font-medium text-gray-900">Cobro #{done.folio} registrado</p>
            <p className="mt-1 text-sm text-gray-600">
              {money(done.amount)} en {paymentMethodLabel(method)}
            </p>
            {done.changeCents > 0 && (
              <p className="mt-4 text-2xl font-semibold text-gray-900" data-testid="collection-change">
                Cambio: {money(done.changeCents)}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Registrar Cobro"
        size="md"
        footer={
          <>
            <DialogClose asChild>
              <Button>Cancelar</Button>
            </DialogClose>
            <Button variant="primary" disabled={!valid || busy} onClick={confirm}>
              Cobrar {valid ? money(cents!) : ''}
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
          <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 text-sm">
            <span className="text-gray-700">{target.saleId ? 'Deuda de la venta' : `Deuda de ${clientName ?? 'el cliente'}`}</span>
            <span className="font-semibold text-gray-900" data-testid="collect-debt">
              {money(debt ?? 0)}
            </span>
          </div>
          <Field label="Monto a cobrar" htmlFor="collect-amount" error={tooMuch ? `No puede ser mayor que la deuda (${money(debt!)})` : undefined} help={!tooMuch && cents && debt && cents < debt ? 'Abono parcial: el resto queda como deuda.' : undefined}>
            <InputGroup id="collect-amount" type="number" inputMode="decimal" min={0} step="0.01" prefix="$" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <div>
            <p className="text-sm font-medium text-gray-800">Método de pago</p>
            <div role="radiogroup" aria-label="Método de pago" className="mt-1.5 grid grid-cols-2 gap-2">
              {CASH_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={method === m}
                  onClick={() => setMethod(m)}
                  className={cn(
                    'flex h-11 items-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
                    method === m ? 'ring-2 ring-sky-600' : 'ring-1 ring-gray-300 hover:bg-gray-50',
                  )}
                >
                  <MethodIcon method={m} />
                  {paymentMethodLabel(m)}
                </button>
              ))}
            </div>
          </div>
          {method === 'cash' && (
            <Field
              label={<>Efectivo recibido<span className="ml-1 font-normal text-gray-400">(opcional)</span></>}
              htmlFor="collect-received"
              error={short ? 'El efectivo recibido no alcanza' : undefined}
              help={!short && receivedCents && cents && receivedCents > cents ? `Cambio: ${money(receivedCents - cents)}` : undefined}
            >
              <InputGroup id="collect-received" type="number" inputMode="decimal" min={0} step="0.01" prefix="$" placeholder={cents ? (cents / 100).toFixed(2) : '0.00'} value={received} onChange={(e) => setReceived(e.target.value)} />
            </Field>
          )}
          {plan.length > 0 && !tooMuch && (
            <div>
              <p className="text-sm font-medium text-gray-800">Se aplica a</p>
              <ul className="mt-1.5 divide-y divide-gray-200 rounded-lg ring-1 ring-gray-200" aria-label="Reparto del cobro">
                {plan
                  .filter((p) => p.applied > 0)
                  .map((p) => (
                    <li key={p.saleId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="text-gray-900">Venta {saleFolio(p.folio)}</span>
                      <span className="flex items-center gap-3">
                        <span className="text-gray-900">{money(p.applied)}</span>
                        {p.balanceAfter === 0 ? <Badge tone="success">Liquidada</Badge> : <Badge tone="debt">Resta {money(p.balanceAfter)}</Badge>}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Estado de Cuenta" (J-client-statement.png), sin Compartir ni Imprimir (no se pidieron). */
export function StatementDialog({ open, onOpenChange, clientId, clientName, onCollect }: { open: boolean; onOpenChange: (o: boolean) => void; clientId: string; clientName: string; onCollect: () => void }) {
  const d = useLiveQuery((tx) => clientDebtSummary(tx, clientId), [clientId]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Estado de Cuenta"
        size="md"
        bodyTone="gray"
        footer={
          <>
            <DialogClose asChild>
              <Button>Cerrar</Button>
            </DialogClose>
            {!!d?.total && (
              <Button variant="primary" onClick={onCollect}>
                Registrar Cobro
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <Card className="flex items-center gap-4 p-4">
            <span className="flex size-10 items-center justify-center rounded-full bg-gray-100 text-gray-600">
              <User className="size-5" />
            </span>
            <div className="text-sm">
              <p className="font-medium text-gray-900">{clientName}</p>
              <p className="text-gray-600">Ventas con Deuda: {d?.sales.length ?? 0}</p>
              <p className="text-gray-600">
                Deuda Pendiente: <span className="font-semibold text-gray-900">{money(d?.total ?? 0)}</span>
              </p>
            </div>
          </Card>
          <Card>
            {!d || d.sales.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">El cliente no tiene deuda.</p>
            ) : (
              <ul className="divide-y divide-gray-200">
                {d.sales.map((s) => {
                  const overdue = !!s.due_date && new Date(s.due_date) < new Date();
                  return (
                    <li key={s.id} className="flex items-start justify-between gap-3 p-4 text-sm">
                      <div>
                        <Link to={`/sales/detail?id=${s.id}`} className="font-medium text-sky-600 hover:text-sky-700" onClick={() => onOpenChange(false)}>
                          Venta {saleFolio(s.folio)}
                        </Link>
                        <p className="text-gray-900">{money(s.total_cents)}</p>
                        {s.due_date && <p className={overdue ? 'text-red-700' : 'text-gray-500'}>{dueText(s.due_date)}</p>}
                      </div>
                      <Badge tone="debt">{money(s.balance_cents)} adeudados</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Últimos Cobros": cada cobro con sus ventas, y ⋯ con Imprimir Ticket y Cancelar Cobro (antes del corte, D24). */
export function CollectionsList({ rows }: { rows: CollectionRow[] }) {
  const db = useDb();
  const toast = useToast();
  const [cancel, setCancel] = React.useState<CollectionRow | null>(null);
  return (
    <>
      <ul className="divide-y divide-gray-200">
        {rows.map((c) => (
          <li key={c.id} className="flex items-start gap-3 py-4">
            <ReceiptText className={cn('mt-0.5 size-5 shrink-0', c.canceled_at ? 'text-gray-400' : 'text-green-600')} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-gray-900">
                  Cobro #{c.folio}
                  <span className="font-normal text-gray-600">
                    {' '}
                    de{' '}
                    {c.sales.map((s, i) => (
                      <React.Fragment key={s.id}>
                        {i > 0 && ', '}
                        <Link to={`/sales/detail?id=${s.id}`} className="text-sky-600 hover:text-sky-700">
                          Venta {saleFolio(s.folio)}
                        </Link>
                      </React.Fragment>
                    ))}
                  </span>
                </p>
                <span className={cn('text-sm', c.canceled_at ? 'text-gray-400 line-through' : 'text-gray-900')}>{money(c.amount_cents)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="text-sm text-gray-500">
                  {formatRelativeDateTime(new Date(c.created_at))} · {paymentMethodLabel(c.method)}
                </span>
                <span className="flex items-center gap-2">
                  {c.canceled_at && <Badge tone="danger">Cancelado</Badge>}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" aria-label={`Acciones del cobro #${c.folio}`} className="-m-1 rounded p-1 text-gray-600 hover:bg-gray-100">
                        <MoreHorizontal className="size-5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem icon={<Printer />} onSelect={() => printCollectionTicket(db.read.bind(db), c.id).catch((e) => toast.error(e))}>
                        Imprimir Ticket
                      </DropdownMenuItem>
                      {!c.canceled_at && (
                        <DropdownMenuItem icon={<XCircle />} className="text-red-700" disabled={c.in_cut} onSelect={() => setCancel(c)}>
                          {c.in_cut ? 'Ya está en un corte' : 'Cancelar Cobro'}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!cancel}
        onOpenChange={(o) => !o && setCancel(null)}
        title="Cancelar cobro"
        description={cancel ? `El cobro #${cancel.folio} de ${money(cancel.amount_cents)} se cancelará: la deuda vuelve a las ventas y el dinero sale de la caja. Queda en el historial como cancelado.` : ''}
        confirmLabel="Cancelar Cobro"
        cancelLabel="Volver"
        onConfirm={async () => {
          try {
            await db.write((tx) => cancelCollection(tx, cancel!.id));
            toast.success('Cobro cancelado');
          } catch (e) {
            toast.error(e);
          }
        }}
      />
    </>
  );
}
