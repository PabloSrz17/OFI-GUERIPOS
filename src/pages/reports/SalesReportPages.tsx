import { Link } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { AreaChart } from '@/components/charts/area-chart';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TotalRow, TR } from '@/components/ui/table';
import { GranularityControl, HBars, money, moneyRound, PeriodControl, ReportPage, SalesGroupControl, useReportParams } from '@/components/reports/ReportKit';
import { useLiveQuery } from '@/db/hooks';
import { formatMoney, formatMoneyShort } from '@/lib/format';
import { periodLabel } from '@/reports/period';
import {
  salesByClient,
  salesByClientCsv,
  salesByPaymentMethod,
  salesByPaymentMethodCsv,
  salesByPeriod,
  salesByPeriodCsv,
  salesByProduct,
  salesByProductCsv,
  type ProductOrder,
} from '@/repos/reports';

export type SalesMetric = 'count' | 'total' | 'margin';
export const METRICS: { value: SalesMetric; label: string }[] = [
  { value: 'count', label: 'Ventas' },
  { value: 'total', label: 'Facturación' },
  { value: 'margin', label: 'Margen' },
];

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, ''));

/** "Reporte de Ventas" por fecha (I-report-sales-by-period.png), con la métrica del gráfico elegible. */
export function SalesByPeriodReport() {
  const params = useReportParams();
  const metric = (params.sp.get('metric') as SalesMetric) || 'count';
  const data = useLiveQuery((tx) => salesByPeriod(tx, params.period, params.granularity), [params.period.from, params.period.to, params.granularity]);
  const m = METRICS.find((x) => x.value === metric) ?? METRICS[0];
  const isMoney = metric !== 'count';
  const headline = data ? (isMoney ? moneyRound(data.totals[metric]) : data.totals.count) : '';
  return (
    <ReportPage
      title="Reporte de Ventas"
      filename="reporte-de-ventas.csv"
      csv={(tx) => salesByPeriodCsv(tx, params.period, params.granularity)}
      controls={
        <>
          <GranularityControl params={params} />
          <PeriodControl params={params} />
          <SalesGroupControl current="/reports/sales" params={params} />
          <Select aria-label="Métrica" icon={<TrendingUp className="size-4" />} value={metric} onValueChange={(v) => params.set({ metric: v === 'count' ? null : v })} options={METRICS} />
        </>
      }
    >
      <Card className="p-6">
        <p className="text-base font-medium text-gray-900">{m.label}</p>
        <p className="text-3xl font-semibold text-gray-900" data-testid="report-headline">
          {headline}
        </p>
        <p className="text-sm text-gray-500">{periodLabel(params.period)}</p>
        {data && (
          <AreaChart
            className="mt-6"
            height={320}
            data={data.buckets.map((b) => ({ label: b.short, value: isMoney ? b[metric] / 100 : b.count }))}
            aria-label={`${m.label} por ${params.granularity === 'day' ? 'día' : 'mes'}`}
            formatY={isMoney ? formatMoneyShort : String}
            formatValue={isMoney ? formatMoney : (v) => `${v} ventas`}
          />
        )}
      </Card>
      <Card className="p-6">
        <Table>
          <THead>
            <TR>
              <TH>Fecha</TH>
              <TH align="right">Ventas</TH>
              <TH align="right">Ventas Totales</TH>
              <TH align="right">Costo Total</TH>
              <TH align="right">Margen</TH>
            </TR>
          </THead>
          <TBody>
            {data && (
              <TotalRow>
                <TD>Total</TD>
                <TD align="right">{data.totals.count}</TD>
                <TD align="right">{money(data.totals.total)}</TD>
                <TD align="right">{money(data.totals.cost)}</TD>
                <TD align="right">{money(data.totals.margin)}</TD>
              </TotalRow>
            )}
            {data &&
              [...data.buckets].reverse().map((b) => (
                <TR key={b.key}>
                  <TD>{b.label}</TD>
                  <TD align="right">{b.count}</TD>
                  <TD align="right">{money(b.total)}</TD>
                  <TD align="right">{money(b.cost)}</TD>
                  <TD align="right">{money(b.margin)}</TD>
                </TR>
              ))}
          </TBody>
        </Table>
      </Card>
    </ReportPage>
  );
}

const ORDERS: { value: ProductOrder; label: string }[] = [
  { value: 'total', label: 'Más vendidos (Facturación)' },
  { value: 'margin', label: 'Con más margen' },
  { value: 'quantity', label: 'Más unidades' },
];

/** "Productos más Vendidos" / "Productos con más Margen". */
export function SalesByProductReport() {
  const params = useReportParams();
  const order = (params.sp.get('order') as ProductOrder) || 'total';
  const rows = useLiveQuery((tx) => salesByProduct(tx, params.period, order), [params.period.from, params.period.to, order]);
  const totals = (rows ?? []).reduce((a, r) => ({ total: a.total + r.total, cost: a.cost + r.cost, margin: a.margin + r.margin }), { total: 0, cost: 0, margin: 0 });
  return (
    <ReportPage
      title={order === 'margin' ? 'Productos con más Margen' : 'Productos más Vendidos'}
      filename="ventas-por-producto.csv"
      csv={(tx) => salesByProductCsv(tx, params.period, order)}
      controls={
        <>
          <PeriodControl params={params} />
          <SalesGroupControl current="/reports/products" params={params} />
          <Select aria-label="Ordenar" value={order} onValueChange={(v) => params.set({ order: v === 'total' ? null : v })} options={ORDERS} />
        </>
      }
    >
      <Card className="p-6">
        {rows && rows.length === 0 ? (
          <EmptyState title="Sin ventas" description="No hay ventas en las fechas seleccionadas." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Producto</TH>
                <TH align="right">Cantidad</TH>
                <TH align="right">Ventas</TH>
                <TH align="right">Facturación</TH>
                <TH align="right">Costo</TH>
                <TH align="right">Margen</TH>
              </TR>
            </THead>
            <TBody>
              <TotalRow>
                <TD>Total</TD>
                <TD />
                <TD />
                <TD align="right">{money(totals.total)}</TD>
                <TD align="right">{money(totals.cost)}</TD>
                <TD align="right">{money(totals.margin)}</TD>
              </TotalRow>
              {rows?.map((r) => (
                <TR key={r.key}>
                  <TD>
                    {r.product_id ? (
                      <Link to={`/products/detail?id=${r.product_id}`} className="font-medium text-sky-600 hover:text-sky-700">
                        {r.name}
                      </Link>
                    ) : (
                      r.name
                    )}
                    {r.sku && <span className="block text-xs text-gray-500">{r.sku}</span>}
                  </TD>
                  <TD align="right">{qty(r.quantity)}</TD>
                  <TD align="right">{r.sales}</TD>
                  <TD align="right">{money(r.total)}</TD>
                  <TD align="right">{money(r.cost)}</TD>
                  <TD align="right" className={r.margin < 0 ? 'text-red-700' : undefined}>
                    {money(r.margin)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </ReportPage>
  );
}

/** "Ventas por Método de Pago" (I-report-payment-methods.png). */
export function SalesByPaymentMethodReport() {
  const params = useReportParams();
  const rows = useLiveQuery((tx) => salesByPaymentMethod(tx, params.period), [params.period.from, params.period.to]) ?? [];
  const total = rows.reduce((a, r) => a + r.total, 0);
  const count = rows.reduce((a, r) => a + r.count, 0);
  return (
    <ReportPage
      title="Ventas por Método de Pago"
      filename="ventas-por-metodo-de-pago.csv"
      csv={(tx) => salesByPaymentMethodCsv(tx, params.period)}
      controls={
        <>
          <PeriodControl params={params} />
          <SalesGroupControl current="/reports/payment-methods" params={params} />
        </>
      }
    >
      <Card className="p-6">
        <p className="text-base font-medium text-gray-900">Facturación</p>
        <p className="text-3xl font-semibold text-gray-900">{moneyRound(total)}</p>
        <p className="text-sm text-gray-500">{periodLabel(params.period)}</p>
        <div className="mt-6 max-w-2xl">
          <HBars rows={rows.map((r) => ({ label: r.label, value: r.total, extra: total ? `${Math.round((r.total / total) * 100)}%` : undefined }))} />
        </div>
      </Card>
      <Card className="p-6">
        <Table>
          <THead>
            <TR>
              <TH>Método de Pago</TH>
              <TH align="right">Ventas</TH>
              <TH align="right">Total</TH>
              <TH align="right">% del Total</TH>
            </TR>
          </THead>
          <TBody>
            <TotalRow>
              <TD>Total</TD>
              <TD align="right">{count}</TD>
              <TD align="right">{money(total)}</TD>
              <TD align="right">{total ? '100%' : '—'}</TD>
            </TotalRow>
            {rows.map((r) => (
              <TR key={r.method}>
                <TD>{r.label}</TD>
                <TD align="right">{r.count}</TD>
                <TD align="right">{money(r.total)}</TD>
                <TD align="right">{total ? `${((r.total / total) * 100).toFixed(1)}%` : '—'}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </ReportPage>
  );
}

/** "Ventas por Cliente". */
export function SalesByClientReport() {
  const params = useReportParams();
  const rows = useLiveQuery((tx) => salesByClient(tx, params.period), [params.period.from, params.period.to]);
  const t = (rows ?? []).reduce((a, r) => ({ count: a.count + r.count, total: a.total + r.total, margin: a.margin + r.margin, debt: a.debt + r.debt }), { count: 0, total: 0, margin: 0, debt: 0 });
  return (
    <ReportPage
      title="Ventas por Cliente"
      filename="ventas-por-cliente.csv"
      csv={(tx) => salesByClientCsv(tx, params.period)}
      controls={
        <>
          <PeriodControl params={params} />
          <SalesGroupControl current="/reports/clients" params={params} />
        </>
      }
    >
      <Card className="p-6">
        {rows && rows.length === 0 ? (
          <EmptyState title="Sin ventas" description="No hay ventas en las fechas seleccionadas." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cliente</TH>
                <TH align="right">Ventas</TH>
                <TH align="right">Total</TH>
                <TH align="right">Margen</TH>
                <TH align="right">Deuda Pendiente</TH>
              </TR>
            </THead>
            <TBody>
              <TotalRow>
                <TD>Total</TD>
                <TD align="right">{t.count}</TD>
                <TD align="right">{money(t.total)}</TD>
                <TD align="right">{money(t.margin)}</TD>
                <TD align="right">{money(t.debt)}</TD>
              </TotalRow>
              {rows?.map((r) => (
                <TR key={r.client_id ?? 'none'}>
                  <TD>
                    {r.client_id ? (
                      <Link to={`/clients/detail?id=${r.client_id}`} className="font-medium text-sky-600 hover:text-sky-700">
                        {r.name}
                      </Link>
                    ) : (
                      r.name
                    )}
                  </TD>
                  <TD align="right">{r.count}</TD>
                  <TD align="right">{money(r.total)}</TD>
                  <TD align="right">{money(r.margin)}</TD>
                  <TD align="right" className={r.debt > 0 ? 'font-medium text-red-800' : undefined}>
                    {r.debt > 0 ? money(r.debt) : ''}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </ReportPage>
  );
}
