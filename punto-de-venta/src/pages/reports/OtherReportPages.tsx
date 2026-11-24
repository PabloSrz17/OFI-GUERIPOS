import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { InputGroup } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { Table, TBody, TD, TH, THead, TotalRow, TR } from '@/components/ui/table';
import { Figure, money, moneyRound, PeriodControl, ReportPage, useReportParams } from '@/components/reports/ReportKit';
import { useLiveQuery } from '@/db/hooks';
import { paymentMethodLabel, saleFolio } from '@/domain/sale';
import { formatMoney, formatRelativeDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  inventoryValue,
  inventoryValueCsv,
  moneyMovements,
  moneyMovementsCsv,
  receivables,
  receivablesCsv,
  stockCsv,
  stockReport,
  stockStatusLabel,
  type MoneyDirection,
  type StockStatus,
} from '@/repos/reports';

/** Búsqueda con espera corta, guardada en la URL. */
function useSearchParam(params: ReturnType<typeof useReportParams>) {
  const q = params.sp.get('q') ?? '';
  const [text, setText] = React.useState(q);
  React.useEffect(() => {
    const t = setTimeout(() => text !== q && params.set({ q: text.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return { q, text, setText };
}

/** "Movimientos de Dinero" (I-report-money-movements.png): el libro de caja. */
export function MoneyMovementsReport() {
  const params = useReportParams();
  const direction = (params.sp.get('dir') as MoneyDirection) || 'all';
  const { q, text, setText } = useSearchParam(params);
  const data = useLiveQuery((tx) => moneyMovements(tx, params.period, { direction, q }), [params.period.from, params.period.to, direction, q]);
  return (
    <ReportPage title="Movimientos de Dinero" filename="movimientos-de-dinero.csv" csv={(tx) => moneyMovementsCsv(tx, params.period, { direction, q })} controls={<PeriodControl params={params} />}>
      <Card className="grid grid-cols-2 gap-6 p-6 md:grid-cols-4">
        <Figure label="Movimientos" value={data?.totals.count ?? 0} />
        <Figure label="Entradas" value={<span className="text-green-700">{formatMoney((data?.totals.in ?? 0) / 100, { signed: true })}</span>} />
        <Figure label="Salidas" value={<span className="text-red-700">{money(data?.totals.out ?? 0)}</span>} />
        <Figure label="Neto" value={<span data-testid="money-net">{money(data?.totals.net ?? 0)}</span>} />
      </Card>
      <Card className="p-6">
        <div className="flex flex-wrap gap-4">
          <Segmented
            aria-label="Tipo de movimiento"
            value={direction}
            onChange={(v) => params.set({ dir: v === 'all' ? null : v })}
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'in', label: 'Entradas' },
              { value: 'out', label: 'Salidas' },
            ]}
          />
          <div className="min-w-60 flex-1">
            <InputGroup icon={<Search />} placeholder="Buscar movimiento" aria-label="Buscar movimiento" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>
        {data && data.rows.length === 0 ? (
          <EmptyState className="mt-4" title="Sin movimientos" description="No hay movimientos de dinero con estos filtros." />
        ) : (
          <Table wrapperClassName="mt-4">
            <THead>
              <TR>
                <TH>Fecha</TH>
                <TH>Movimiento</TH>
                <TH>Método de Pago</TH>
                <TH>Tipo</TH>
                <TH align="right">Monto</TH>
                <TH>Caja</TH>
                <TH>Usuario</TH>
              </TR>
            </THead>
            <TBody>
              {data?.rows.map((r) => {
                const isIn = r.amount_cents >= 0;
                const folio = r.sale_folio ? `Venta ${saleFolio(r.sale_folio)}` : null;
                const idx = folio ? r.label.indexOf(folio) : -1;
                return (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap text-gray-700">{formatRelativeDateTime(new Date(r.created_at))}</TD>
                    <TD>
                      {folio && idx >= 0 ? (
                        <>
                          {r.label.slice(0, idx)}
                          <Link to={`/sales/detail?id=${r.sale_id}`} className="text-sky-600 hover:text-sky-700">
                            {folio}
                          </Link>
                          {r.label.slice(idx + folio.length)}
                        </>
                      ) : (
                        r.label
                      )}
                    </TD>
                    <TD>{paymentMethodLabel(r.method)}</TD>
                    <TD>
                      {isIn ? (
                        <Badge tone="success" className="gap-1">
                          <ArrowUp className="size-3" />
                          Entrada
                        </Badge>
                      ) : (
                        <Badge tone="danger" className="gap-1">
                          <ArrowDown className="size-3" />
                          Salida
                        </Badge>
                      )}
                    </TD>
                    <TD align="right" className={cn('whitespace-nowrap font-medium', isIn ? 'text-green-700' : 'text-red-700')}>
                      {formatMoney(r.amount_cents / 100, { signed: true })}
                    </TD>
                    <TD>
                      <Link to="/cash" className="text-sky-600 hover:text-sky-700">
                        {r.register_name}
                      </Link>
                    </TD>
                    <TD>{r.user_name}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </ReportPage>
  );
}

/** "Cuentas por Cobrar" (diseño propio, D28; en Pulpos es Plan Pro): deuda de hoy por cliente según su vencimiento. */
export function ReceivablesReport() {
  const data = useLiveQuery((tx) => receivables(tx), []);
  const t = data?.totals;
  return (
    <ReportPage title="Cuentas por Cobrar" filename="cuentas-por-cobrar.csv" csv={receivablesCsv}>
      <Card className="grid grid-cols-2 gap-6 p-6 md:grid-cols-5">
        <Figure label="Total por Cobrar" value={<span data-testid="receivables-total">{moneyRound(t?.total ?? 0)}</span>} />
        <Figure label="Vencido" value={moneyRound(t?.overdue ?? 0)} tone={t?.overdue ? 'danger' : undefined} />
        <Figure label="0 a 7 días" value={moneyRound(t?.d0_7 ?? 0)} />
        <Figure label="8 a 30 días" value={moneyRound(t?.d8_30 ?? 0)} />
        <Figure label="+30 días" value={moneyRound(t?.d30 ?? 0)} />
      </Card>
      <Card className="p-6">
        <p className="mb-4 text-sm text-gray-500">Deuda al día de hoy. Los días cuentan hasta el vencimiento de cada venta.</p>
        {data && data.rows.length === 0 ? (
          <EmptyState title="Sin cuentas por cobrar" description="Ningún cliente tiene deuda pendiente." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cliente</TH>
                <TH align="right">Ventas con Deuda</TH>
                <TH align="right">Deuda Total</TH>
                <TH align="right">Vencida</TH>
                <TH align="right">0 a 7 días</TH>
                <TH align="right">8 a 30 días</TH>
                <TH align="right">+30 días</TH>
              </TR>
            </THead>
            <TBody>
              {t && (
                <TotalRow>
                  <TD>Total ({t.clients} {t.clients === 1 ? 'cliente' : 'clientes'})</TD>
                  <TD align="right">{t.sales}</TD>
                  <TD align="right">{money(t.total)}</TD>
                  <TD align="right">{money(t.overdue)}</TD>
                  <TD align="right">{money(t.d0_7)}</TD>
                  <TD align="right">{money(t.d8_30)}</TD>
                  <TD align="right">{money(t.d30)}</TD>
                </TotalRow>
              )}
              {data?.rows.map((r) => (
                <TR key={r.client_id}>
                  <TD>
                    <Link to={`/clients/detail?id=${r.client_id}`} className="font-medium text-sky-600 hover:text-sky-700">
                      {r.name}
                    </Link>
                  </TD>
                  <TD align="right">{r.sales}</TD>
                  <TD align="right" className="font-medium">
                    {money(r.total)}
                  </TD>
                  <TD align="right" className={r.overdue > 0 ? 'font-medium text-red-700' : 'text-gray-400'}>
                    {money(r.overdue)}
                  </TD>
                  <TD align="right" className={r.d0_7 ? undefined : 'text-gray-400'}>
                    {money(r.d0_7)}
                  </TD>
                  <TD align="right" className={r.d8_30 ? undefined : 'text-gray-400'}>
                    {money(r.d8_30)}
                  </TD>
                  <TD align="right" className={r.d30 ? undefined : 'text-gray-400'}>
                    {money(r.d30)}
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

const STATUS_TONE: Record<StockStatus, 'success' | 'warning' | 'danger'> = { ok: 'success', low: 'warning', out: 'danger' };
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, ''));

/** "Stock de Productos": existencias, mínimo y estado de cada producto. */
export function StockReport() {
  const params = useReportParams();
  const status = (params.sp.get('status') as StockStatus | 'all') || 'all';
  const { q, text, setText } = useSearchParam(params);
  const data = useLiveQuery((tx) => stockReport(tx, { q, status }), [q, status]);
  const c = data?.counts;
  return (
    <ReportPage title="Stock de Productos" filename="stock-de-productos.csv" csv={(tx) => stockCsv(tx, { q, status })}>
      <Card className="p-6">
        <div className="flex flex-wrap gap-4">
          <Segmented
            aria-label="Estado del stock"
            value={status}
            onChange={(v) => params.set({ status: v === 'all' ? null : v })}
            options={[
              { value: 'all', label: `Todos (${c?.all ?? 0})` },
              { value: 'ok', label: `Con stock (${c?.ok ?? 0})` },
              { value: 'low', label: `Bajo stock (${c?.low ?? 0})` },
              { value: 'out', label: `Sin stock (${c?.out ?? 0})` },
            ]}
          />
          <div className="min-w-60 flex-1">
            <InputGroup icon={<Search />} placeholder="Buscar por nombre, SKU o categoría" aria-label="Buscar producto" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>
        {data && data.rows.length === 0 ? (
          <EmptyState className="mt-4" title="Sin productos" description="No hay productos con estos filtros." />
        ) : (
          <Table wrapperClassName="mt-4">
            <THead>
              <TR>
                <TH>Producto</TH>
                <TH>Categoría</TH>
                <TH align="right">Stock</TH>
                <TH align="right">Stock Mínimo</TH>
                <TH>Estado</TH>
                <TH align="right">Costo</TH>
                <TH align="right">Precio</TH>
              </TR>
            </THead>
            <TBody>
              {data?.rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link to={`/products/detail?id=${r.id}`} className="font-medium text-sky-600 hover:text-sky-700">
                      {r.name}
                    </Link>
                    {r.sku && <span className="block text-xs text-gray-500">{r.sku}</span>}
                  </TD>
                  <TD>{r.category}</TD>
                  <TD align="right" className={r.stock < 0 ? 'text-red-700' : undefined}>
                    {num(r.stock)}
                  </TD>
                  <TD align="right">{r.min_stock ? num(r.min_stock) : '—'}</TD>
                  <TD>
                    <Badge tone={STATUS_TONE[r.status]}>{stockStatusLabel(r.status)}</Badge>
                  </TD>
                  <TD align="right">{money(r.cost_cents)}</TD>
                  <TD align="right">{money(r.price_cents)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </ReportPage>
  );
}

/** "Valor del Inventario": valor a precio, costo y margen, por categoría (D29). */
export function InventoryValueReport() {
  const data = useLiveQuery((tx) => inventoryValue(tx), []);
  const t = data?.totals;
  return (
    <ReportPage title="Valor del Inventario" filename="valor-del-inventario.csv" csv={inventoryValueCsv}>
      <Card className="grid grid-cols-3 gap-6 p-6">
        <Figure label="Valor Total" value={<span data-testid="inventory-value">{moneyRound(t?.value ?? 0)}</span>} />
        <Figure label="Costo Total" value={moneyRound(t?.cost ?? 0)} />
        <Figure label="Margen Total" value={moneyRound(t?.margin ?? 0)} />
      </Card>
      <Card className="p-6">
        <p className="mb-4 text-sm text-gray-500">
          Valor = stock × precio de la lista {'"'}Público{'"'}; costo = stock × costo del producto. Solo se cuenta el stock positivo
          {t?.negative ? ` (${t.negative} ${t.negative === 1 ? 'producto tiene' : 'productos tienen'} stock negativo y no suman).` : '.'}
        </p>
        <Table>
          <THead>
            <TR>
              <TH>Categoría</TH>
              <TH align="right">Productos</TH>
              <TH align="right">Unidades</TH>
              <TH align="right">Valor</TH>
              <TH align="right">Costo</TH>
              <TH align="right">Margen</TH>
            </TR>
          </THead>
          <TBody>
            {t && (
              <TotalRow>
                <TD>Total</TD>
                <TD align="right">{t.products}</TD>
                <TD align="right">{num(t.units)}</TD>
                <TD align="right">{money(t.value)}</TD>
                <TD align="right">{money(t.cost)}</TD>
                <TD align="right">{money(t.margin)}</TD>
              </TotalRow>
            )}
            {data?.rows.map((r) => (
              <TR key={r.category}>
                <TD>{r.category}</TD>
                <TD align="right">{r.products}</TD>
                <TD align="right">{num(r.units)}</TD>
                <TD align="right">{money(r.value)}</TD>
                <TD align="right">{money(r.cost)}</TD>
                <TD align="right">{money(r.margin)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </ReportPage>
  );
}
