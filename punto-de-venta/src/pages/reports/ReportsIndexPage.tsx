import { Link } from 'react-router-dom';
import { AreaChart } from '@/components/charts/area-chart';
import { Page, PageHeader } from '@/components/layout/Page';
import { Badge } from '@/components/ui/badge';
import { Figure, GranularityControl, HBars, money, moneyRound, PeriodControl, PreviewCard, PreviewTable, useReportParams } from '@/components/reports/ReportKit';
import { useLiveQuery } from '@/db/hooks';
import { formatMoney, formatMoneyShort } from '@/lib/format';
import { inventoryValue, moneyMovements, receivables, salesByClient, salesByPaymentMethod, salesByPeriod, salesByProduct, stockReport } from '@/repos/reports';
import { METRICS, type SalesMetric } from './SalesReportPages';

/** Índice de reportes (I-reports-index.png): vistas previas del periodo elegido, por sección. */
export function ReportsIndexPage() {
  const params = useReportParams();
  const { period, granularity, keep } = params;
  const data = useLiveQuery(
    (tx) => ({
      sales: salesByPeriod(tx, period, granularity),
      top: salesByProduct(tx, period, 'total').slice(0, 4),
      margin: salesByProduct(tx, period, 'margin').slice(0, 4),
      methods: salesByPaymentMethod(tx, period).filter((m) => m.total > 0),
      clients: salesByClient(tx, period).slice(0, 4),
      receivables: receivables(tx).totals,
      money: moneyMovements(tx, period).rows.slice(0, 4),
      stock: stockReport(tx).counts,
      inventory: inventoryValue(tx).totals,
    }),
    [period.from, period.to, granularity],
  );
  const link = (path: string, extra = '') => `${path}${keep}${extra ? `${keep ? '&' : '?'}${extra}` : ''}`;
  const sep = keep ? '&' : '?';

  return (
    <Page width="narrow" className="max-w-[1160px]">
      <PageHeader title="Reportes" />
      <div className="mb-6 flex flex-wrap gap-3">
        <GranularityControl params={params} />
        <PeriodControl params={params} />
      </div>

      <h3 className="mb-4 text-lg font-medium text-gray-900">Ventas</h3>
      <div className="grid gap-4 md:grid-cols-3">
        {METRICS.map((m) => {
          const metric = m.value as SalesMetric;
          const isMoney = metric !== 'count';
          return (
            <PreviewCard key={m.value} title={m.label} to={`/reports/sales${keep}${metric === 'count' ? '' : `${sep}metric=${metric}`}`}>
              <p className="mt-2 text-3xl font-semibold text-gray-900" data-testid={`kpi-${metric}`}>
                {data ? (isMoney ? moneyRound(data.sales.totals[metric]) : data.sales.totals.count) : ''}
              </p>
              {data && (
                <AreaChart
                  className="mt-4"
                  height={200}
                  data={data.sales.buckets.map((b) => ({ label: b.short, value: isMoney ? b[metric] / 100 : b.count }))}
                  aria-label={`${m.label} del periodo`}
                  formatY={isMoney ? formatMoneyShort : String}
                  formatValue={isMoney ? formatMoney : (v) => `${v} ventas`}
                />
              )}
            </PreviewCard>
          );
        })}
        <PreviewCard title="Productos más Vendidos" to={link('/reports/products')}>
          <PreviewTable head={['Producto', 'Facturación']} rows={(data?.top ?? []).map((r) => [r.name, money(r.total)])} />
        </PreviewCard>
        <PreviewCard title="Productos con más Margen" to={link('/reports/products', 'order=margin')}>
          <PreviewTable head={['Producto', 'Margen']} rows={(data?.margin ?? []).map((r) => [r.name, money(r.margin)])} />
        </PreviewCard>
        <PreviewCard title="Ventas por Cliente" to={link('/reports/clients')}>
          <PreviewTable head={['Cliente', 'Total']} rows={(data?.clients ?? []).map((r) => [r.name, money(r.total)])} />
        </PreviewCard>
        <PreviewCard title="Ventas por Método de Pago" to={link('/reports/payment-methods')} className="p-6 md:col-span-3">
          <div className="mt-4 max-w-2xl">
            {data && data.methods.length === 0 ? <p className="text-sm text-gray-500">No hay ventas en las fechas seleccionadas</p> : <HBars rows={(data?.methods ?? []).map((r) => ({ label: r.label, value: r.total }))} />}
          </div>
        </PreviewCard>
      </div>

      <h3 className="mb-4 mt-10 text-lg font-medium text-gray-900">Finanzas</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <PreviewCard title="Cuentas por Cobrar" to="/reports/receivables">
          <p className="mt-2 text-3xl font-semibold text-gray-900">{moneyRound(data?.receivables.total ?? 0)}</p>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label="Vencido" value={moneyRound(data?.receivables.overdue ?? 0)} tone={data?.receivables.overdue ? 'danger' : undefined} />
            <Figure label="0 a 7 días" value={moneyRound(data?.receivables.d0_7 ?? 0)} />
            <Figure label="8 a 30 días" value={moneyRound(data?.receivables.d8_30 ?? 0)} />
            <Figure label="+30 días" value={moneyRound(data?.receivables.d30 ?? 0)} />
          </div>
        </PreviewCard>
        <PreviewCard title="Movimientos de Dinero" to={link('/reports/transactions')}>
          <PreviewTable
            head={['Movimiento', 'Monto']}
            empty="No hay movimientos en las fechas seleccionadas"
            rows={(data?.money ?? []).map((r) => [r.label, <span className={r.amount_cents >= 0 ? 'text-green-700' : 'text-red-700'}>{formatMoney(r.amount_cents / 100, { signed: true })}</span>])}
          />
        </PreviewCard>
      </div>

      <h3 className="mb-4 mt-10 text-lg font-medium text-gray-900">Inventario</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <PreviewCard title="Stock de Productos" to="/reports/stock">
          <ul className="mt-4 space-y-3 text-sm">
            {(
              [
                ['ok', 'Con stock', 'success'],
                ['low', 'Bajo stock', 'warning'],
                ['out', 'Sin stock', 'danger'],
              ] as const
            ).map(([k, label, tone]) => (
              <li key={k} className="flex items-center justify-between">
                <Link to={`/reports/stock?status=${k}`} className="hover:underline">
                  <Badge tone={tone}>{label}</Badge>
                </Link>
                <span className="text-gray-900">
                  {data?.stock[k] ?? 0} {data?.stock[k] === 1 ? 'producto' : 'productos'}
                </span>
              </li>
            ))}
          </ul>
        </PreviewCard>
        <PreviewCard title="Valor del Inventario" to="/reports/inventory">
          <div className="mt-4 grid grid-cols-3 gap-4">
            <Figure label="Valor Total" value={moneyRound(data?.inventory.value ?? 0)} />
            <Figure label="Costo Total" value={moneyRound(data?.inventory.cost ?? 0)} />
            <Figure label="Margen Total" value={moneyRound(data?.inventory.margin ?? 0)} />
          </div>
        </PreviewCard>
      </div>
    </Page>
  );
}
