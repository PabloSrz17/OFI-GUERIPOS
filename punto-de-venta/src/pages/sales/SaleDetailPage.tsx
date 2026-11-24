import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronDown, CircleDollarSign, CirclePlus, Clock, History, MessageSquare, Pencil, Printer, ShoppingCart, Trash2, Wallet, X } from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/input';
import { EmptyState, Thumb } from '@/components/ui/misc';
import { ConfirmDialog, useToast } from '@/components/ui/feedback';
import { ClientPickerDialog, NoteDialog } from '@/components/pos/PosDialogs';
import { useDb, useLiveQuery } from '@/db/hooks';
import { quantityUnit } from '@/domain/catalog';
import { dueText, paymentMethodLabel, saleFolio } from '@/domain/sale';
import { addSaleComment, deleteSale, deliverSale, DELIVERY_METHODS, getSale, setSaleClient, setSaleNote, type SaleEvent } from '@/repos/sales';
import { printSaleTicket } from '@/sales/ticket';
import { formatMoney, formatQuantity, formatRelativeDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DeliveryBadge, PaymentBadge } from './SalesListPage';
import { CollectDialog } from '@/components/collections/CollectionDialogs';

const money = (c: number) => formatMoney(c / 100);

const EVENT_ICONS: Record<string, React.ReactNode> = {
  created: <CirclePlus />,
  payment: <Wallet />,
  credit: <Wallet />,
  collection: <CircleDollarSign />,
  collection_canceled: <X />,
  delivery: <ShoppingCart />,
  reserved: <ShoppingCart />,
  deleted: <Trash2 />,
  comment: <MessageSquare />,
};

function Timeline({ events }: { events: SaleEvent[] }) {
  return (
    <ol className="ml-2 mt-4 border-l-2 border-gray-200">
      {events.map((e) => (
        <li key={e.id} className="relative pb-6 pl-8 last:pb-2">
          <span className={cn('absolute -left-[11px] top-0 flex size-5 items-center justify-center bg-white text-sky-600 [&_svg]:size-5', (e.type === 'deleted' || e.type === 'collection_canceled') && 'text-red-600', e.type === 'comment' && 'text-gray-500')}>
            {EVENT_ICONS[e.type] ?? <Clock />}
          </span>
          <div className="flex items-start justify-between gap-4">
            <p className={cn('text-sm font-medium text-gray-900', e.type === 'comment' && 'whitespace-pre-line font-normal')}>{e.title}</p>
            <time className="shrink-0 text-sm text-gray-500">{formatRelativeDateTime(new Date(e.created_at))}</time>
          </div>
          <p className="mt-1 text-sm text-gray-500">{e.type === 'comment' ? e.user_name : e.detail}</p>
        </li>
      ))}
    </ol>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-gray-200 px-6 py-6 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {action}
      </div>
      <div className="mt-3 text-sm text-gray-700">{children}</div>
    </section>
  );
}

const link = 'text-sm font-medium text-sky-600 hover:text-sky-700';

/** Detalle de venta (B-sale-detail.png, B-sale-detail-debt.png). */
export function SaleDetailPage() {
  const db = useDb();
  const toast = useToast();
  const [sp] = useSearchParams();
  const id = sp.get('id') ?? '';
  const s = useLiveQuery((tx) => getSale(tx, id), [id]);
  const [modal, setModal] = React.useState<null | 'delete' | 'deliver' | 'client' | 'note' | 'collect'>(null);
  const [comment, setComment] = React.useState('');

  if (s === undefined) return null;
  if (s === null)
    return (
      <Page width="narrow">
        <PageHeader back="/sales" title="Detalle de Venta" />
        <Card>
          <EmptyState title="Venta no encontrada" />
        </Card>
      </Page>
    );

  const deleted = !!s.deleted_at;
  const label = `${s.mode === 'order' ? 'Pedido' : 'Venta'} ${saleFolio(s.folio)}`;
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Page width="narrow">
      <PageHeader
        back="/sales"
        title={label}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button disabled={deleted}>
                  Más Acciones
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem icon={<Trash2 className="text-red-600" />} onSelect={() => setModal('delete')}>
                  Eliminar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => run(() => printSaleTicket(db.read.bind(db), s.id, { copy: true }))}>
              <Printer />
              Imprimir Ticket
            </Button>
          </>
        }
      />

      {deleted && (
        <div role="alert" className="mb-4 flex items-center gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="size-5" />
          Esta venta fue eliminada {formatRelativeDateTime(new Date(s.deleted_at!)).toLowerCase()}. El stock y el dinero se regresaron.
        </div>
      )}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          <Card>
            <div className="px-6 pt-6">
              <DeliveryBadge status={s.delivery_status} icon />
            </div>
            <div className="px-6">
              <table className="mt-4 min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="py-3 font-semibold text-gray-900">Producto</th>
                    <th className="py-3 pr-8 text-right font-semibold text-gray-900">Cantidad</th>
                    <th className="py-3 text-right font-semibold text-gray-900">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {s.items.map((i) => (
                    <tr key={i.id} className="align-middle">
                      <td className="py-4">
                        <div className="flex items-center gap-3">
                          <Thumb src={i.image ?? undefined} />
                          <div className="min-w-0">
                            {i.sku && <p className="text-xs text-gray-500">{i.sku}</p>}
                            {i.product_id && i.product_exists ? (
                              <Link to={`/products/detail?id=${i.product_id}`} className={link}>
                                {i.name}
                              </Link>
                            ) : (
                              <p className="font-medium text-gray-900">{i.name}</p>
                            )}
                            <p className="flex flex-wrap items-center gap-2 text-gray-500">
                              {money(i.unit_price_cents)}
                              {i.product_id && !i.price_list_id && (
                                <Badge className="bg-violet-50 text-violet-700">
                                  <CircleDollarSign />
                                  Personalizado
                                </Badge>
                              )}
                              {!i.product_id && <Badge>Entrada manual</Badge>}
                            </p>
                            {i.discount_cents > 0 && (
                              <p className="text-xs text-green-700">
                                Descuento{i.discount_label ? ` ${i.discount_label}` : ''}: -{money(i.discount_cents)}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap py-4 pr-8 text-right text-gray-700">{i.unit === 'unit' ? i.quantity : formatQuantity(i.quantity, quantityUnit(i.unit))}</td>
                      <td className="py-4 text-right text-gray-700">{money(i.total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {s.delivery_status === 'pending' && !deleted && (
              <div className="flex justify-end border-t border-gray-200 px-6 py-4">
                <Button onClick={() => setModal('deliver')}>Entregar Productos</Button>
              </div>
            )}
          </Card>

          <Card className="space-y-2 p-6 text-sm">
            <div className="flex justify-between text-gray-700">
              <span>Subtotal</span>
              <span>{money(s.subtotal_cents)}</span>
            </div>
            <div className="flex justify-between text-gray-700">
              <span>Descuentos</span>
              <span>{s.discount_cents > 0 ? `-${money(s.discount_cents)}` : money(0)}</span>
            </div>
            {s.taxes_removed_cents > 0 && (
              <div className="flex justify-between text-gray-700">
                <span>Impuestos removidos</span>
                <span>-{money(s.taxes_removed_cents)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-gray-900">
              <span>Total</span>
              <span>{money(s.total_cents)}</span>
            </div>
            {s.tax_cents > 0 && <p className="text-right text-xs text-gray-500">Incluye impuestos por {money(s.tax_cents)}</p>}
          </Card>

          <Card className="p-6">
            <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
              <History className="size-5" />
              Historial
            </h3>
            <form
              className="mt-4 flex items-start gap-3 rounded-lg bg-gray-50 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!comment.trim()) return;
                run(async () => {
                  await db.write((tx) => addSaleComment(tx, s.id, comment));
                  setComment('');
                });
              }}
            >
              <Textarea aria-label="Añadir un Comentario" placeholder="Añadir un Comentario" rows={1} value={comment} onChange={(e) => setComment(e.target.value)} className="flex-1" />
              {comment.trim() && (
                <Button type="submit" variant="primary">
                  Comentar
                </Button>
              )}
            </form>
            <Timeline events={s.events} />
          </Card>
        </div>

        <div className="w-full shrink-0 space-y-4 lg:w-[288px]">
          <Card>
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-5">
              <h3 className="text-sm font-semibold text-gray-900">Estado</h3>
              <PaymentBadge balance={s.balance_cents} icon />
            </div>
            <dl className="space-y-3 px-6 py-5 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-700">Total</dt>
                <dd className="text-gray-900">{money(s.total_cents)}</dd>
              </div>
              {s.balance_cents > 0 && (
                <>
                  <div className="flex justify-between">
                    <dt className="text-gray-700">Abonado</dt>
                    <dd className="text-gray-900">{money(s.paid_cents)}</dd>
                  </div>
                  <div className="flex justify-between font-medium text-red-800">
                    <dt>Adeudado</dt>
                    <dd>{money(s.balance_cents)}</dd>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <dt className="text-gray-700">Método</dt>
                <dd className="text-gray-900">{paymentMethodLabel(s.payment_method)}</dd>
              </div>
              {s.payment_method === 'cash' && s.received_cents !== null && (
                <>
                  <div className="flex justify-between">
                    <dt className="text-gray-700">Recibido</dt>
                    <dd className="text-gray-900">{money(s.received_cents)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-700">Cambio</dt>
                    <dd className="text-gray-900">{money(s.change_cents)}</dd>
                  </div>
                </>
              )}
            </dl>
            {s.balance_cents > 0 && s.due_date && !deleted && (
              <p className={cn('flex items-center gap-2 border-t border-gray-200 px-6 py-4 text-sm', new Date(s.due_date) < new Date() ? 'text-red-700' : 'text-gray-600')}>
                <Clock className="size-4" />
                {dueText(s.due_date)}
              </p>
            )}
            {s.balance_cents > 0 && !deleted && (
              <div className="border-t border-gray-200 px-6 py-4">
                <Button variant="primary" className="w-full" onClick={() => setModal('collect')}>
                  <CircleDollarSign />
                  Registrar Cobro
                </Button>
              </div>
            )}
          </Card>

          <Card>
            <Section title="Fecha">{formatRelativeDateTime(new Date(s.created_at))}</Section>
            <Section title="Caja">{s.register_name}</Section>
            <Section title="Cajero">{s.user_name}</Section>
            {s.delivery_method && <Section title="Forma de Entrega">{DELIVERY_METHODS.find((d) => d.value === s.delivery_method)?.label}</Section>}
            <Section
              title="Cliente"
              action={
                s.client_id && s.credit_cents === 0 && !deleted ? (
                  <button type="button" aria-label="Quitar cliente" className="rounded p-1 text-gray-500 hover:bg-gray-100" onClick={() => run(() => db.write((tx) => setSaleClient(tx, s.id, null)))}>
                    <X className="size-5" />
                  </button>
                ) : null
              }
            >
              {s.client_id ? (
                <Link to={`/clients/detail?id=${s.client_id}`} className={link}>
                  {s.client_name}
                </Link>
              ) : deleted ? (
                'Público en General'
              ) : (
                <button type="button" className={link} onClick={() => setModal('client')}>
                  Asignar Cliente
                </button>
              )}
            </Section>
            <Section
              title="Nota"
              action={
                s.note && !deleted ? (
                  <button type="button" aria-label="Editar nota" className="rounded p-1 text-gray-600 hover:bg-gray-100" onClick={() => setModal('note')}>
                    <Pencil className="size-5" />
                  </button>
                ) : null
              }
            >
              {s.note ? (
                <p className="whitespace-pre-line">{s.note}</p>
              ) : deleted ? (
                '—'
              ) : (
                <button type="button" className={link} onClick={() => setModal('note')}>
                  Añadir Nota
                </button>
              )}
            </Section>
          </Card>
        </div>
      </div>

      <CollectDialog open={modal === 'collect'} onOpenChange={(o) => !o && setModal(null)} target={{ saleId: s.id }} />
      <ConfirmDialog
        open={modal === 'delete'}
        onOpenChange={(o) => !o && setModal(null)}
        title={`Eliminar ${label}`}
        description={
          s.delivery_status === 'delivered'
            ? `Se regresarán al inventario los productos entregados${s.paid_cents > 0 ? ` y se descontarán ${money(s.paid_cents)} de la caja` : ''}. La venta quedará en el historial como eliminada.`
            : `${s.paid_cents > 0 ? `Se descontarán ${money(s.paid_cents)} de la caja. ` : ''}La venta quedará en el historial como eliminada.`
        }
        confirmLabel="Eliminar Venta"
        onConfirm={() => run(() => db.write((tx) => deleteSale(tx, s.id)), 'Venta eliminada')}
      />
      <ConfirmDialog
        open={modal === 'deliver'}
        onOpenChange={(o) => !o && setModal(null)}
        title="Entregar Productos"
        description="Se descontarán del inventario los productos de esta venta."
        confirmLabel="Entregar"
        tone="primary"
        onConfirm={() => run(() => db.write((tx) => deliverSale(tx, s.id)), 'Productos entregados')}
      />
      <ClientPickerDialog
        open={modal === 'client'}
        onOpenChange={(o) => !o && setModal(null)}
        onPick={(c) => {
          setModal(null);
          if (c) run(() => db.write((tx) => setSaleClient(tx, s.id, c.id)));
        }}
      />
      <NoteDialog open={modal === 'note'} onOpenChange={(o) => !o && setModal(null)} value={s.note ?? ''} onSave={(note) => run(() => db.write((tx) => setSaleNote(tx, s.id, note)))} />
    </Page>
  );
}

