import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, CircleDollarSign, Download, Plus, Search, SlidersHorizontal, Tags, Trash2 } from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { InputGroup } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ConfirmDialog, useToast } from '@/components/ui/feedback';
import { ClientDialog } from '@/components/clients/ClientDialogs';
import { useDb, useLiveQuery } from '@/db/hooks';
import { listPriceLists } from '@/repos/categories';
import { clientName, clientPhone, clientsCsv, deleteClients, listClients, type ClientDebtFilter, type ClientSort } from '@/repos/clients';
import { formatMoney } from '@/lib/format';
import { download } from '@/lib/download';

const PAGE_SIZE = 25;

const SORT_OPTIONS: { value: ClientSort; label: string }[] = [
  { value: 'name-asc', label: 'Nombre (A - Z)' },
  { value: 'name-desc', label: 'Nombre (Z - A)' },
  { value: 'created-asc', label: 'Creación (antiguos primero)' },
  { value: 'created-desc', label: 'Creación (recientes primero)' },
];

interface ClientFilters {
  list: string | null;
  debt: ClientDebtFilter | null;
}
const DEBT_OPTIONS = [
  { value: 'all', label: 'Cualquier estado' },
  { value: 'none', label: 'Sin deuda' },
  { value: 'overdue', label: 'Deuda Vencida' },
  { value: 'current', label: 'Deuda no Vencida' },
];

/** Modal "Filtros" (J-clients-filter.png): Lista de Precio y Estado de Deuda. Saldo en Monedero queda fuera del alcance. */
function ClientFiltersDialog({ value, onApply }: { value: ClientFilters; onApply: (f: ClientFilters) => void }) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<ClientFilters>(value);
  const active = (f: ClientFilters) => (f.list ? 1 : 0) + (f.debt ? 1 : 0);
  const lists = useLiveQuery(listPriceLists, []) ?? [];
  React.useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <SlidersHorizontal />
          Filtrar
          {active(value) > 0 && <span className="rounded-full bg-sky-600 px-1.5 text-xs leading-5 text-white">{active(value)}</span>}
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Filtros"
        size="md"
        bodyTone="gray"
        footer={
          <>
            <Button onClick={() => setDraft({ list: null, debt: null })}>
              <Trash2 />
              Limpiar Filtros ({active(draft)})
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
        <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-lg bg-white p-6 shadow-card">
          <span className="flex items-center gap-3 text-sm font-medium text-gray-900 [&_svg]:size-5 [&_svg]:text-gray-600">
            <Tags />
            Lista de Precio
          </span>
          <Select
            aria-label="Lista de Precio"
            className="w-60"
            value={draft.list ?? 'all'}
            onValueChange={(v) => setDraft((d) => ({ ...d, list: v === 'all' ? null : v }))}
            options={[{ value: 'all', label: 'Todas las listas' }, ...lists.map((l) => ({ value: l.id, label: l.name }))]}
          />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg bg-white p-6 shadow-card">
          <span className="flex items-center gap-3 text-sm font-medium text-gray-900 [&_svg]:size-5 [&_svg]:text-gray-600">
            <CircleDollarSign />
            Estado de Deuda
          </span>
          <Select
            aria-label="Estado de Deuda"
            className="w-60"
            value={draft.debt ?? 'all'}
            onValueChange={(v) => setDraft((d) => ({ ...d, debt: v === 'all' ? null : (v as ClientDebtFilter) }))}
            options={DEBT_OPTIONS}
          />
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Lista de clientes (J-clients-list.png). */
export function ClientsListPage() {
  const db = useDb();
  const toast = useToast();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const page = Number(sp.get('p') ?? '1') || 1;
  const sort = (sp.get('sort') as ClientSort) || 'name-asc';
  const priceListId = sp.get('list');
  const debt = (sp.get('debt') as ClientDebtFilter | null) || null;
  const [search, setSearch] = React.useState(q);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [creating, setCreating] = React.useState(sp.get('new') === '1');

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
    if (sp.get('new') === '1') update({ new: null });
  }, [sp, update]);

  React.useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => update({ q: search.trim() || null, p: null }), 200);
    return () => clearTimeout(t);
  }, [search, q, update]);

  const result = useLiveQuery((tx) => listClients(tx, { q, sort, priceListId: priceListId ?? undefined, debt: debt ?? undefined, page, pageSize: PAGE_SIZE }), [q, sort, priceListId, debt, page]);
  const rows = result?.rows ?? [];
  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const filtered = q !== '' || !!priceListId;

  return (
    <Page>
      <PageHeader
        title="Clientes"
        actions={
          <>
            <Button onClick={async () => download('clientes.csv', await db.read(clientsCsv))}>
              <Download />
              Exportar
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus />
              Agregar Cliente
            </Button>
          </>
        }
      />
      <Card className="p-6">
        <div className="flex gap-4">
          <div className="flex-1">
            <InputGroup icon={<Search />} placeholder="Filtrar por nombre, teléfono o email" aria-label="Buscar clientes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <ClientFiltersDialog value={{ list: priceListId, debt }} onApply={(v) => update({ list: v.list, debt: v.debt, p: null })} />
          <Select aria-label="Ordenar" value={sort} onValueChange={(v) => update({ sort: v === 'name-asc' ? null : v, p: null })} icon={<ArrowDownUp className="size-4" />} triggerLabel="Ordenar" options={SORT_OPTIONS} />
        </div>

        {selected.size > 0 && (
          <div className="mt-4 flex items-center gap-4 rounded-lg bg-sky-50 px-4 py-2 text-sm text-sky-800">
            <span className="font-medium">
              {selected.size} {selected.size === 1 ? 'cliente seleccionado' : 'clientes seleccionados'}
            </span>
            <Button size="sm" variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => setConfirmDelete(true)}>
              <Trash2 />
              Eliminar
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
              Quitar selección
            </Button>
          </div>
        )}

        {result && result.total === 0 ? (
          filtered ? (
            <EmptyState className="mt-4" muted title="No se encontraron clientes para esta búsqueda" />
          ) : (
            <EmptyState
              className="mt-4"
              title="Aún no tienes clientes"
              description="Registra a tus clientes para venderles a crédito y llevar su historial."
              actions={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Agregar Cliente
                </Button>
              }
            />
          )
        ) : (
          <>
            <Table wrapperClassName="mt-4">
              <THead>
                <tr>
                  <TH className="w-12 pl-6">
                    <Checkbox
                      aria-label="Seleccionar todos"
                      checked={allOnPage}
                      onCheckedChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          pageIds.forEach((id) => (allOnPage ? n.delete(id) : n.add(id)));
                          return n;
                        })
                      }
                    />
                  </TH>
                  <TH>Nombre</TH>
                  <TH>Teléfono</TH>
                  <TH>Email</TH>
                  <TH align="center">Cantidad de Ventas</TH>
                  <TH align="center">Deuda</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((c) => (
                  <TR key={c.id} interactive className="cursor-pointer" onClick={() => navigate(`/clients/detail?id=${c.id}`)}>
                    <TD className="pl-6" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        aria-label={`Seleccionar ${clientName(c)}`}
                        checked={selected.has(c.id)}
                        onCheckedChange={() =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (n.has(c.id)) n.delete(c.id);
                            else n.add(c.id);
                            return n;
                          })
                        }
                      />
                    </TD>
                    <TD>
                      <Link to={`/clients/detail?id=${c.id}`} onClick={(e) => e.stopPropagation()} className="text-sm font-medium text-sky-600 hover:text-sky-700">
                        {clientName(c)}
                      </Link>
                    </TD>
                    <TD>{clientPhone(c)}</TD>
                    <TD>{c.email}</TD>
                    <TD align="center">{c.sales_count || ''}</TD>
                    <TD align="center">{c.debt_cents > 0 ? <span className="font-medium text-sky-600">{formatMoney(c.debt_cents / 100)}</span> : ''}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {result && result.totalPages > 1 && <Pagination className="mt-6" page={result.page} totalPages={result.totalPages} onPageChange={(n) => update({ p: n === 1 ? null : String(n) })} />}
          </>
        )}
      </Card>

      <ClientDialog open={creating} onOpenChange={setCreating} onSaved={(id) => navigate(`/clients/detail?id=${id}`)} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={selected.size === 1 ? 'Eliminar cliente' : `Eliminar ${selected.size} clientes`}
        description="Dejarán de aparecer en la lista y en el punto de venta. Su historial se conserva."
        confirmLabel="Eliminar"
        onConfirm={async () => {
          try {
            const n = await db.write((tx) => deleteClients(tx, [...selected]));
            setSelected(new Set());
            toast.success(n === 1 ? 'Cliente eliminado' : `${n} clientes eliminados`);
          } catch (e) {
            toast.error(e);
          }
        }}
      />
    </Page>
  );
}
