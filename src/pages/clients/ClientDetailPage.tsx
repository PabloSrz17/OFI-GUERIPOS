import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, Clock, ExternalLink, Pencil, ShoppingCart, Trash2 } from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/misc';
import { ConfirmDialog, useToast } from '@/components/ui/feedback';
import { ClientDialog, CommentsDialog, CreditLimitDialog, PriceListDialog } from '@/components/clients/ClientDialogs';
import { useDb, useLiveQuery } from '@/db/hooks';
import { clientName, clientPhone, deleteClients, effectiveCreditLimit, formatAddress, getClient } from '@/repos/clients';
import { formatMoney, formatRelativeDateTime } from '@/lib/format';
import { clientRecentSales } from '@/repos/sales';
import { dueText, saleFolio } from '@/domain/sale';
import { DeliveryBadge, PaymentBadge } from '@/pages/sales/SalesListPage';

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm text-gray-600">{label}</p>
      <p className="mt-0.5 text-lg font-medium text-gray-900">{value}</p>
    </div>
  );
}

/** Sección de la tarjeta derecha: título 14/600 con ✎ y contenido 14 gris oscuro. */
function Section({ title, onEdit, children }: { title: string; onEdit?: () => void; children: React.ReactNode }) {
  return (
    <section className="border-b border-gray-200 px-6 py-6 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {onEdit && (
          <button type="button" aria-label={`Editar ${title}`} onClick={onEdit} className="-m-1 rounded p-1 text-gray-600 hover:bg-gray-100 hover:text-gray-900">
            <Pencil className="size-5" />
          </button>
        )}
      </div>
      <div className="mt-3 space-y-1 text-sm text-gray-700">{children}</div>
    </section>
  );
}

const linkClass = 'text-sm font-medium text-sky-600 hover:text-sky-700';
const money = (cents: number) => formatMoney(cents / 100).replace(/\.00$/, '');

/** Detalle del cliente (J-client-detail-nodebt.png). Ventas, deuda y cobros se llenan en las Etapas 5 y 7. */
export function ClientDetailPage() {
  const db = useDb();
  const toast = useToast();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const id = sp.get('id') ?? '';
  const data = useLiveQuery(
    (tx) => {
      const c = getClient(tx, id);
      return c ? { c, limit: effectiveCreditLimit(tx, c), sales: clientRecentSales(tx, c.id) } : null;
    },
    [id],
  );
  const [modal, setModal] = React.useState<null | 'edit' | 'list' | 'limit' | 'comments' | 'delete'>(null);
  const [more, setMore] = React.useState(false);

  if (data === undefined) return null;
  if (data === null)
    return (
      <Page width="narrow">
        <PageHeader back="/clients" title="Detalle del Cliente" />
        <Card>
          <EmptyState title="Cliente no encontrado" description="Es posible que se haya eliminado." />
        </Card>
      </Page>
    );

  const { c, limit, sales } = data;
  const name = clientName(c);
  const address = formatAddress(c);
  const close = (o: boolean) => !o && setModal(null);

  return (
    <Page width="narrow">
      <PageHeader
        back="/clients"
        title={name}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                Más Acciones
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem icon={<ShoppingCart />} onSelect={() => navigate(`/pos?client=${c.id}`)}>
                Nueva Venta
              </DropdownMenuItem>
              <DropdownMenuItem icon={<Trash2 />} className="text-red-700" onSelect={() => setModal('delete')}>
                Eliminar Cliente
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          <Card className="grid grid-cols-3 gap-6 p-6">
            <Stat label="Ventas" value={c.sales_count} />
            <Stat label="Total Vendido" value={money(c.total_sold_cents)} />
            <Stat label="Deuda Pendiente" value={money(c.debt_cents)} />
          </Card>
          <Card className="p-6">
            <h3 className="text-base font-semibold text-gray-900">Últimas Ventas</h3>
            {sales.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">Este cliente todavía no tiene ventas.</p>
            ) : (
              <>
                <ul className="mt-2 divide-y divide-gray-200">
                  {sales.map((s) => (
                    <li key={s.id} className="py-4">
                      <div className="flex items-center justify-between gap-4">
                        <Link to={`/sales/detail?id=${s.id}`} className="text-sm font-medium text-sky-600 hover:text-sky-700">
                          Venta {saleFolio(s.folio)}
                        </Link>
                        <span className="text-sm text-gray-900">{formatMoney(s.total_cents / 100)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm text-gray-500">{formatRelativeDateTime(new Date(s.created_at))}</span>
                        <span className="flex flex-wrap items-center gap-2">
                          {s.balance_cents > 0 && s.due_date && (
                            <span className={`flex items-center gap-1 text-xs ${new Date(s.due_date) < new Date() ? 'text-red-700' : 'text-gray-500'}`}>
                              <Clock className="size-3.5" />
                              {dueText(s.due_date)}
                            </span>
                          )}
                          <PaymentBadge balance={s.balance_cents} />
                          <DeliveryBadge status={s.delivery_status as 'delivered' | 'pending'} />
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                <Button className="mt-2" onClick={() => navigate(`/sales?client=${c.id}`)}>
                  <ExternalLink />
                  Ver Todas las Ventas
                </Button>
              </>
            )}
          </Card>
        </div>

        <Card className="w-full shrink-0 lg:w-[288px]">
          <Section title="Datos Básicos" onEdit={() => setModal('edit')}>
            <p>{name}</p>
            {more && (
              <dl className="space-y-3 pt-2">
                {[
                  ['Teléfono', clientPhone(c)],
                  ['Email', c.email],
                  ['Dirección', address],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-gray-500">{k}</dt>
                    <dd className="text-gray-700">{v || '—'}</dd>
                  </div>
                ))}
              </dl>
            )}
            <button type="button" className={`${linkClass} pt-2`} onClick={() => setMore((m) => !m)}>
              {more ? 'Ver Menos' : 'Ver Más'}
            </button>
          </Section>
          <Section title="Lista de Precios" onEdit={() => setModal('list')}>
            <p>{c.price_list_name ?? 'Sin lista asignada'}</p>
          </Section>
          <Section title="Límite de Crédito" onEdit={() => setModal('limit')}>
            <p>{limit === null ? 'Sin limitar' : formatMoney(limit / 100)}</p>
            {c.credit_limit_cents === null && limit !== null && <p className="text-xs text-gray-500">Límite predeterminado</p>}
          </Section>
          <Section title="Comentarios" onEdit={c.comments ? () => setModal('comments') : undefined}>
            {c.comments ? (
              <p className="whitespace-pre-line">{c.comments}</p>
            ) : (
              <button type="button" className={linkClass} onClick={() => setModal('comments')}>
                Agregar
              </button>
            )}
          </Section>
        </Card>
      </div>

      <ClientDialog open={modal === 'edit'} onOpenChange={close} client={c} />
      <PriceListDialog open={modal === 'list'} onOpenChange={close} client={c} />
      <CreditLimitDialog open={modal === 'limit'} onOpenChange={close} client={c} />
      <CommentsDialog open={modal === 'comments'} onOpenChange={close} client={c} />
      <ConfirmDialog
        open={modal === 'delete'}
        onOpenChange={close}
        title="Eliminar cliente"
        description={`${name} dejará de aparecer en la lista y en el punto de venta. Su historial se conserva.`}
        confirmLabel="Eliminar"
        onConfirm={async () => {
          try {
            await db.write((tx) => deleteClients(tx, [c.id]));
            toast.success('Cliente eliminado');
            navigate('/clients', { replace: true });
          } catch (e) {
            toast.error(e);
          }
        }}
      />
    </Page>
  );
}
