import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, Calendar, CreditCard, Download, HandCoins, Percent, Plus, Search, ShoppingCart, SlidersHorizontal, Trash2, User, CircleDollarSign } from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { InputGroup } from '@/components/ui/input';
import { EmptyState, PillTabs, ToggleChip } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useDb, useLiveQuery } from '@/db/hooks';
import { PAYMENT_METHODS, paymentMethodLabel, saleFolio, type PaymentMethod } from '@/domain/sale';
import { clientName, listClients } from '@/repos/clients';
import { listSales, salesCsv, type SaleFilters, type SaleSort, type SalesTab } from '@/repos/sales';
import { formatMoney, formatRelativeDateTime } from '@/lib/format';
import { download } from '@/lib/download';

const money = (c: number) => formatMoney(c / 100);

const SORT_OPTIONS: { value: SaleSort; label: string }[] = [
  { value: 'created-desc', label: 'Más recientes' },
  { value: 'created-asc', label: 'Más antiguas' },
  { value: 'total-desc', label: 'Mayor total' },
  { value: 'total-asc', label: 'Menor total' },
];

export type DateRange = 'today' | 'yesterday' | 'week' | 'month' | 'last_month';
export const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'week', label: 'Últimos 7 días' },
  { value: 'month', label: 'Este mes' },
  { value: 'last_month', label: 'Mes anterior' },
];

/** Límites [desde, hasta) en hora local, convertidos a ISO para comparar con created_at. */
export function dateRangeBounds(r: DateRange, now = new Date()): { from: string; to: string } {
  const d = (y: number, m: number, day: number) => new Date(y, m, day);
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = d(y, m, now.getDate());
  const add = (x: Date, days: number) => d(x.getFullYear(), x.getMonth(), x.getDate() + days);
  const range = {
    today: [today, add(today, 1)],
    yesterday: [add(today, -1), today],
    week: [add(today, -6), add(today, 1)],
    month: [d(y, m, 1), d(y, m + 1, 1)],
    last_month: [d(y, m - 1, 1), d(y, m, 1)],
  }[r];
  return { from: range[0].toISOString(), to: range[1].toISOString() };
}

interface UiFilters {
  date?: DateRange;
  method?: PaymentMethod;
  clientId?: string;
  payment?: 'paid' | 'debt';
  delivery?: 'delivered' | 'pending';
  discount?: 'with' | 'without';
}

const PARAMS: Record<keyof UiFilters, string> = { date: 'date', method: 'method', clientId: 'client', payment: 'pay', delivery: 'del', discount: 'disc' };

function readFilters(sp: URLSearchParams): UiFilters {
  const f: Record<string, string> = {};
  for (const [k, p] of Object.entries(PARAMS)) {
    const v = sp.get(p);
    if (v) f[k] = v;
  }
  return f as UiFilters;
}

export function toRepoFilters(f: UiFilters): SaleFilters {
  const { date, ...rest } = f;
  return { ...rest, ...(date ? dateRangeBounds(date) : {}) };
}

function Group({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white p-6 shadow-card">
      <div className="mb-3 flex items-center gap-3 text-sm font-medium text-gray-900 [&_svg]:size-5 [&_svg]:text-gray-600">
        {icon}
        {title}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/** Cada selector va en su propia tarjeta blanca (px-6 py-4), etiqueta en una línea y selector de 244px. */
function SelectRow({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-white px-6 py-4 shadow-card">
      <span className="flex items-center gap-3 whitespace-nowrap text-sm font-medium text-gray-900 [&_svg]:size-5 [&_svg]:text-gray-600">
        {icon}
        {title}
      </span>
      {children}
    </div>
  );
}

/** Modal "Filtros" (B-sales-filter.png): solo lo que aplica a esta app (sin caja, cajero, numeración, factura, devoluciones ni canal). */
function SalesFiltersDialog({ value, onApply }: { value: UiFilters; onApply: (f: UiFilters) => void }) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<UiFilters>(value);
  const clients = useLiveQuery((tx) => listClients(tx, { pageSize: 500 }).rows, []) ?? [];
  React.useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);
  const count = Object.values(draft).filter(Boolean).length;
  const applied = Object.values(value).filter(Boolean).length;
  const chip = <K extends 'payment' | 'delivery' | 'discount'>(k: K, v: NonNullable<UiFilters[K]>, label: string) => (
    <ToggleChip active={draft[k] === v} onClick={() => setDraft({ ...draft, [k]: draft[k] === v ? undefined : v })}>
      {label}
    </ToggleChip>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <SlidersHorizontal />
          Filtrar
          {applied > 0 && <span className="rounded-full bg-sky-600 px-1.5 text-xs leading-5 text-white">{applied}</span>}
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Filtros"
        size="md"
        className="max-w-[523px]"
        bodyTone="gray"
        bodyClassName="space-y-3"
        footer={
          <>
            <Button onClick={() => setDraft({})}>
              <Trash2 />
              Limpiar Filtros ({count})
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
            >
              Ver Resultados
            </Button>
          </>
        }
      >
        <SelectRow icon={<Calendar />} title="Fecha">
            <Select aria-label="Fecha" className="w-[244px]" value={draft.date ?? 'all'} onValueChange={(v) => setDraft({ ...draft, date: v === 'all' ? undefined : (v as DateRange) })} options={[{ value: 'all', label: 'Seleccionar Fecha' }, ...DATE_RANGES]} />
          </SelectRow>
          <SelectRow icon={<CreditCard />} title="Método de Pago">
            <Select
              aria-label="Método de Pago"
              className="w-[244px]"
              value={draft.method ?? 'all'}
              onValueChange={(v) => setDraft({ ...draft, method: v === 'all' ? undefined : (v as PaymentMethod) })}
              options={[{ value: 'all', label: 'Todos los Métodos de Pago' }, ...PAYMENT_METHODS]}
            />
          </SelectRow>
          <SelectRow icon={<User />} title="Cliente">
            <Select
              aria-label="Cliente"
              className="w-[244px]"
              value={draft.clientId ?? 'all'}
              onValueChange={(v) => setDraft({ ...draft, clientId: v === 'all' ? undefined : v })}
              options={[{ value: 'all', label: 'Todos los Clientes' }, ...clients.map((c) => ({ value: c.id, label: clientName(c) }))]}
            />
          </SelectRow>
        <Group icon={<HandCoins />} title="Pago">
          {chip('payment', 'paid', 'Pagadas')}
          {chip('payment', 'debt', 'Deuda Pendiente')}
        </Group>
        <Group icon={<ShoppingCart />} title="Entrega">
          {chip('delivery', 'delivered', 'Entregadas')}
          {chip('delivery', 'pending', 'No entregadas')}
        </Group>
        <Group icon={<Percent />} title="Descuentos">
          {chip('discount', 'with', 'Con descuento')}
          {chip('discount', 'without', 'Sin descuento')}
        </Group>
      </DialogContent>
    </Dialog>
  );
}

/** En el detalle (B-sale-detail-debt.png) las pills son más grandes, de esquinas poco redondeadas y con ícono. */
const LARGE = 'rounded px-2.5 py-1 text-sm [&_svg]:size-4';

export function PaymentBadge({ balance, icon }: { balance: number; icon?: boolean }) {
  return balance > 0 ? (
    <Badge tone="debt" className={icon ? LARGE : undefined}>
      {icon && <CircleDollarSign />}
      Deuda pendiente
    </Badge>
  ) : (
    <Badge tone="success" className={icon ? LARGE : undefined}>
      {icon && <CircleDollarSign />}
      Pagada
    </Badge>
  );
}

export function DeliveryBadge({ status, icon }: { status: 'delivered' | 'pending'; icon?: boolean }) {
  return status === 'delivered' ? (
    <Badge tone="success" className={icon ? LARGE : undefined}>
      {icon && <ShoppingCart />}
      Entregados
    </Badge>
  ) : (
    <Badge tone="warning" className={icon ? LARGE : undefined}>
      {icon && <ShoppingCart />}
      No Entregados
    </Badge>
  );
}

/** Historial de ventas (B-sales-list.png). */
export function SalesListPage() {
  const db = useDb();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const page = Number(sp.get('p') ?? '1') || 1;
  const tab = (sp.get('tab') as SalesTab) || 'all';
  const sort = (sp.get('sort') as SaleSort) || 'created-desc';
  const ui = React.useMemo(() => readFilters(sp), [sp]);
  const filters = React.useMemo(() => toRepoFilters(ui), [ui]);
  const [search, setSearch] = React.useState(q);

  const update = React.useCallback(
    (patch: Record<string, string | null>) =>
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === '') n.delete(k);
            else n.set(k, v);
          }
          return n;
        },
        { replace: true },
      ),
    [setSp],
  );

  React.useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => update({ q: search.trim() || null, p: null }), 200);
    return () => clearTimeout(t);
  }, [search, q, update]);

  const result = useLiveQuery((tx) => listSales(tx, { q, tab, filters, sort, page }), [q, tab, filters, sort, page]);
  const rows = result?.rows ?? [];
  const filtered = q !== '' || tab !== 'all' || Object.keys(ui).length > 0;

  return (
    <Page>
      <PageHeader
        title="Ventas"
        actions={
          <>
            <Button onClick={async () => download('ventas.csv', await db.read((tx) => salesCsv(tx, { q, tab, filters })))}>
              <Download />
              Descargar Ventas
            </Button>
            <Button variant="primary" onClick={() => navigate('/pos')}>
              <Plus />
              Nueva Venta
            </Button>
          </>
        }
      />
      <Card className="p-6">
        <div className="flex gap-4">
          <div className="flex-1">
            <InputGroup icon={<Search />} placeholder="Filtrar por folio, productos o cliente" aria-label="Buscar ventas" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <SalesFiltersDialog
            value={ui}
            onApply={(f) => {
              const patch: Record<string, string | null> = { p: null };
              for (const [k, p] of Object.entries(PARAMS)) patch[p] = (f as Record<string, string | undefined>)[k] ?? null;
              update(patch);
            }}
          />
          <Select aria-label="Ordenar" value={sort} onValueChange={(v) => update({ sort: v === 'created-desc' ? null : v, p: null })} icon={<ArrowDownUp className="size-4" />} triggerLabel="Ordenar" options={SORT_OPTIONS} />
        </div>
        <PillTabs
          className="mt-4"
          value={tab}
          onChange={(t) => update({ tab: t === 'all' ? null : t, p: null })}
          tabs={[
            { value: 'all', label: 'Todas' },
            { value: 'pending_payment', label: 'Pagos Pendientes', count: result?.counts.pending ?? 0 },
            { value: 'undelivered', label: 'No Entregadas', count: result?.counts.undelivered ?? 0 },
          ]}
        />

        {result && result.total === 0 ? (
          filtered ? (
            <EmptyState className="mt-4" muted title="No se encontraron ventas" />
          ) : (
            <EmptyState
              className="mt-4"
              title="Aún no tienes ventas"
              description="Las ventas que registres en el punto de venta aparecerán aquí."
              actions={
                <Button variant="primary" onClick={() => navigate('/pos')}>
                  Ir al Punto de Venta
                </Button>
              }
            />
          )
        ) : (
          <>
            <Table wrapperClassName="mt-4">
              <THead>
                <tr>
                  <TH className="pl-6">Venta</TH>
                  <TH>Fecha</TH>
                  <TH align="center">Cliente</TH>
                  <TH align="center">Pago</TH>
                  <TH align="center">Total</TH>
                  <TH align="center">Deuda</TH>
                  <TH align="center">Productos</TH>
                  <TH align="center">Método</TH>
                  <TH align="center">Cajero</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((s) => (
                  <TR key={s.id} interactive className="cursor-pointer" onClick={() => navigate(`/sales/detail?id=${s.id}`)}>
                    <TD className="pl-6">
                      <Link to={`/sales/detail?id=${s.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-sky-600 hover:text-sky-700">
                        {saleFolio(s.folio)}
                      </Link>
                    </TD>
                    <TD className="whitespace-nowrap">{formatRelativeDateTime(new Date(s.created_at))}</TD>
                    <TD align="center">
                      {s.client_id && s.client_first_name && (
                        <Link to={`/clients/detail?id=${s.client_id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-sky-600 hover:text-sky-700">
                          {clientName({ first_name: s.client_first_name, last_name: s.client_last_name })}
                        </Link>
                      )}
                    </TD>
                    <TD align="center">
                      <PaymentBadge balance={s.balance_cents} />
                    </TD>
                    <TD align="center">{money(s.total_cents)}</TD>
                    <TD align="center">{s.balance_cents > 0 ? money(s.balance_cents) : ''}</TD>
                    <TD align="center">
                      <DeliveryBadge status={s.delivery_status} />
                    </TD>
                    <TD align="center" className="whitespace-nowrap">
                      {paymentMethodLabel(s.payment_method)}
                    </TD>
                    <TD align="center">{s.user_name}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {result && result.totalPages > 1 && <Pagination className="mt-6" page={result.page} totalPages={result.totalPages} onPageChange={(n) => update({ p: n === 1 ? null : String(n) })} />}
          </>
        )}
      </Card>
    </Page>
  );
}
