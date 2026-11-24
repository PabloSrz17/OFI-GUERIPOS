import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BarChart3, Calendar, Download, Layers } from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatMoney } from '@/lib/format';
import { download } from '@/lib/download';
import { useDb } from '@/db/hooks';
import type { Tx } from '@/db/database';
import { PERIOD_PRESETS, periodBounds, toDateInput, type Granularity, type Period, type PeriodPreset } from '@/reports/period';

/** $1,234.50 */
export const money = (cents: number) => formatMoney(cents / 100);
/** $1,235 (cifras grandes de las tarjetas, como Pulpos). */
export const moneyRound = (cents: number) => formatMoney(Math.round(cents / 100)).replace(/\.00$/, '');

/** Periodo y granularidad en la URL (?period=7d&from=&to=&g=day), compartidos entre el índice y los reportes. */
export function useReportParams() {
  const [sp, setSp] = useSearchParams();
  const preset = (sp.get('period') as PeriodPreset) || '7d';
  const from = sp.get('from');
  const to = sp.get('to');
  const granularity: Granularity = sp.get('g') === 'month' ? 'month' : 'day';
  const period: Period = React.useMemo(() => periodBounds(preset, { from, to }), [preset, from, to]);
  const set = React.useCallback(
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
  /** Query string del periodo, para enlazar a otro reporte sin perderlo. */
  const keep = React.useMemo(() => {
    const n = new URLSearchParams();
    for (const k of ['period', 'from', 'to', 'g']) {
      const v = sp.get(k);
      if (v) n.set(k, v);
    }
    const s = n.toString();
    return s ? `?${s}` : '';
  }, [sp]);
  return { preset, from, to, granularity, period, set, sp, keep };
}

export function PeriodControl({ params }: { params: ReturnType<typeof useReportParams> }) {
  const { preset, from, to, set } = params;
  const today = toDateInput(new Date());
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Periodo"
        icon={<Calendar className="size-4" />}
        value={preset}
        onValueChange={(v) => set({ period: v === '7d' ? null : v, ...(v === 'custom' ? { from: from ?? toDateInput(new Date(Date.now() - 6 * 86_400_000)), to: to ?? today } : { from: null, to: null }) })}
        options={PERIOD_PRESETS}
      />
      {preset === 'custom' && (
        <>
          <Input type="date" aria-label="Desde" className="w-40" max={to ?? today} value={from ?? ''} onChange={(e) => set({ from: e.target.value })} />
          <span className="text-sm text-gray-500">a</span>
          <Input type="date" aria-label="Hasta" className="w-40" min={from ?? undefined} value={to ?? ''} onChange={(e) => set({ to: e.target.value })} />
        </>
      )}
    </div>
  );
}

export function GranularityControl({ params }: { params: ReturnType<typeof useReportParams> }) {
  return (
    <Select
      aria-label="Agrupar por día o mes"
      icon={<BarChart3 className="size-4" />}
      value={params.granularity}
      onValueChange={(v) => params.set({ g: v === 'day' ? null : v })}
      options={[
        { value: 'day', label: 'Por Día' },
        { value: 'month', label: 'Por Mes' },
      ]}
    />
  );
}

/** "Agrupado por Fecha ▾": cambia entre los reportes de ventas conservando el periodo. */
const SALES_GROUPS = [
  { value: '/reports/sales', label: 'Agrupado por Fecha' },
  { value: '/reports/products', label: 'Agrupado por Producto' },
  { value: '/reports/payment-methods', label: 'Agrupado por Método de Pago' },
  { value: '/reports/clients', label: 'Agrupado por Cliente' },
];
export function SalesGroupControl({ current, params }: { current: string; params: ReturnType<typeof useReportParams> }) {
  const navigate = useNavigate();
  return <Select aria-label="Agrupación" icon={<Layers className="size-4" />} value={current} onValueChange={(v) => navigate(`${v}${params.keep}`)} options={SALES_GROUPS} />;
}

/** Esqueleto de un reporte: ← título, [Descargar Reporte] y la barra de controles. */
export function ReportPage({ title, controls, csv, filename, children }: { title: string; controls?: React.ReactNode; csv: (tx: Tx) => string; filename: string; children: React.ReactNode }) {
  const db = useDb();
  const back = `/reports${useReportParams().keep}`;
  return (
    <Page>
      <PageHeader
        back={back}
        title={title}
        actions={
          <Button variant="primary" onClick={async () => download(filename, await db.read(csv))}>
            <Download />
            Descargar Reporte
          </Button>
        }
      />
      {controls && <div className="mb-4 flex flex-wrap items-center gap-3">{controls}</div>}
      <div className="space-y-4">{children}</div>
    </Page>
  );
}

/** Tarjeta del índice: título, "Ver reporte" y la vista previa. */
export function PreviewCard({ title, to, children, className }: { title: string; to: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className ?? 'p-6'}>
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-base font-medium text-gray-900">{title}</h4>
        <Link to={to} className="shrink-0 text-sm font-medium text-sky-600 hover:text-sky-700">
          Ver reporte
        </Link>
      </div>
      {children}
    </Card>
  );
}

/** Tabla de dos columnas de la vista previa (Producto / Facturación). */
export function PreviewTable({ head, rows, empty = 'No hay ventas en las fechas seleccionadas' }: { head: [string, string]; rows: [React.ReactNode, React.ReactNode][]; empty?: string }) {
  return (
    <div className="-mx-6 mt-4">
      <div className="flex justify-between bg-gray-50 px-6 py-3 text-sm text-gray-600">
        <span>{head[0]}</span>
        <span>{head[1]}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-6 py-6 text-sm text-gray-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {rows.map(([a, b], i) => (
            <li key={i} className="flex justify-between gap-3 px-6 py-3 text-sm">
              <span className="min-w-0 truncate text-gray-900">{a}</span>
              <span className="shrink-0 text-gray-900">{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Barras horizontales de una sola serie; el nombre y el monto van en texto (el color no identifica nada). */
export function HBars({ rows, format = money }: { rows: { label: string; value: number; extra?: string }[]; format?: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between gap-3 text-sm">
            <span className="text-gray-700">{r.label}</span>
            <span className="text-gray-900">
              {format(r.value)}
              {r.extra && <span className="ml-2 text-gray-500">{r.extra}</span>}
            </span>
          </div>
          <div className="mt-1.5 h-2 rounded bg-gray-100">
            <div className="h-2 rounded bg-sky-600" style={{ width: `${r.value > 0 ? Math.max(2, (r.value / max) * 100) : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Cifra con etiqueta (Valor Total, Costo Total…). */
export function Figure({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'danger' }) {
  return (
    <div>
      <p className="text-sm text-gray-600">{label}</p>
      <p className={`mt-0.5 text-lg font-medium ${tone === 'danger' ? 'text-red-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}
