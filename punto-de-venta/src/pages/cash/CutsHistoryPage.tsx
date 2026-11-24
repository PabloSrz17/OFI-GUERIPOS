import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, Calculator, Calendar, Download, Scale, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { InputGroup } from '@/components/ui/input';
import { EmptyState, ToggleChip } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { DifferenceBadge, money } from '@/components/cash/CashDialogs';
import { useDb, useLiveQuery } from '@/db/hooks';
import { cutsCsv, listCuts, type CutFilters, type CutSort } from '@/repos/cash';
import { formatRelativeDateTime } from '@/lib/format';
import { download } from '@/lib/download';
import { DATE_RANGES, dateRangeBounds, type DateRange } from '@/pages/sales/SalesListPage';

const SORT_OPTIONS: { value: CutSort; label: string }[] = [
  { value: 'created-desc', label: 'Más recientes' },
  { value: 'created-asc', label: 'Más antiguos' },
];

interface UiFilters {
  date?: DateRange;
  difference?: 'with' | 'without';
}

function FiltersDialog({ value, onApply }: { value: UiFilters; onApply: (f: UiFilters) => void }) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<UiFilters>(value);
  React.useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);
  const count = Object.values(draft).filter(Boolean).length;
  const applied = Object.values(value).filter(Boolean).length;
  const chip = (v: 'with' | 'without', label: string) => (
    <ToggleChip active={draft.difference === v} onClick={() => setDraft({ ...draft, difference: draft.difference === v ? undefined : v })}>
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
        <div className="flex items-center justify-between gap-4 rounded-lg bg-white px-6 py-4 shadow-card">
          <span className="flex items-center gap-3 whitespace-nowrap text-sm font-medium text-gray-900 [&_svg]:size-5 [&_svg]:text-gray-600">
            <Calendar />
            Fecha
          </span>
          <Select aria-label="Fecha" className="w-[244px]" value={draft.date ?? 'all'} onValueChange={(v) => setDraft({ ...draft, date: v === 'all' ? undefined : (v as DateRange) })} options={[{ value: 'all', label: 'Seleccionar Fecha' }, ...DATE_RANGES]} />
        </div>
        <div className="rounded-lg bg-white p-6 shadow-card">
          <div className="mb-3 flex items-center gap-3 text-sm font-medium text-gray-900 [&_svg]:size-5 [&_svg]:text-gray-600">
            <Scale />
            Diferencia
          </div>
          <div className="flex flex-wrap gap-2">
            {chip('without', 'Sin diferencia')}
            {chip('with', 'Con diferencia')}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Cortes Históricos (H-cash-history.png). */
export function CutsHistoryPage() {
  const db = useDb();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const page = Number(sp.get('p') ?? '1') || 1;
  const sort = (sp.get('sort') as CutSort) || 'created-desc';
  const ui = React.useMemo<UiFilters>(() => ({ date: (sp.get('date') as DateRange) || undefined, difference: (sp.get('diff') as UiFilters['difference']) || undefined }), [sp]);
  const filters = React.useMemo<CutFilters>(() => ({ difference: ui.difference, ...(ui.date ? dateRangeBounds(ui.date) : {}) }), [ui]);
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

  const result = useLiveQuery((tx) => listCuts(tx, { q, filters, sort, page }), [q, filters, sort, page]);
  const rows = result?.rows ?? [];
  const filtered = q !== '' || !!ui.date || !!ui.difference;

  return (
    <Page>
      <PageHeader
        title="Cortes de Caja"
        description={<span className="whitespace-nowrap">Al finalizar cada turno haz un recuento de tu efectivo y otros pagos y compáralos con lo registrado en el sistema.</span>}
        actions={
          <>
            <Button onClick={async () => download('cortes-de-caja.csv', await db.read((tx) => cutsCsv(tx, { q, filters })))}>
              <Download />
              Exportar
            </Button>
            <Button variant="primary" onClick={() => navigate('/cash/cut')}>
              <Calculator />
              Hacer Corte de Caja
            </Button>
          </>
        }
      />
      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-[240px] flex-1">
            <InputGroup icon={<Search />} placeholder="Buscar por caja o vendedor" aria-label="Buscar cortes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <FiltersDialog value={ui} onApply={(f) => update({ date: f.date ?? null, diff: f.difference ?? null, p: null })} />
          <Select aria-label="Ordenar" value={sort} onValueChange={(v) => update({ sort: v === 'created-desc' ? null : v, p: null })} icon={<ArrowDownUp className="size-4" />} triggerLabel="Ordenar" options={SORT_OPTIONS} />
        </div>

        {result && result.total === 0 ? (
          filtered ? (
            <EmptyState className="mt-4" muted title="No se encontraron cortes" />
          ) : (
            <EmptyState
              className="mt-4"
              title="Aún no hay cortes de caja"
              description="Al terminar el turno, haz el corte para comparar lo contado con lo registrado."
              actions={
                <Button variant="primary" onClick={() => navigate('/cash/cut')}>
                  Hacer Corte de Caja
                </Button>
              }
            />
          )
        ) : (
          <>
            <Table wrapperClassName="mt-4">
              <THead>
                <tr>
                  <TH className="pl-6">Fecha</TH>
                  <TH align="center">Caja</TH>
                  <TH align="center">Realizado por</TH>
                  <TH align="center">Total Esperado</TH>
                  <TH align="center">Diferencia</TH>
                  <TH align="center">Comentarios</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((c) => (
                  <TR key={c.id} interactive className="cursor-pointer" onClick={() => navigate(`/cash/history/detail?id=${c.id}`)}>
                    <TD className="pl-6">
                      <Link to={`/cash/history/detail?id=${c.id}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap font-medium text-sky-600 hover:text-sky-700">
                        {formatRelativeDateTime(new Date(c.created_at))}
                      </Link>
                    </TD>
                    <TD align="center">{c.register_name.replace(/^Caja /, '')}</TD>
                    <TD align="center">{c.user_name}</TD>
                    <TD align="center">{money(c.expected_cents)}</TD>
                    <TD align="center">
                      <DifferenceBadge cents={c.difference_cents} />
                    </TD>
                    <TD align="center" className="max-w-[220px] truncate">
                      {c.comments}
                    </TD>
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
