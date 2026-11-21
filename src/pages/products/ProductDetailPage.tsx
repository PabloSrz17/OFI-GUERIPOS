import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, Thumb } from '@/components/ui/misc';
import { ConfirmDialog, useToast } from '@/components/ui/feedback';
import { useDb, useLiveQuery } from '@/db/hooks';
import { COST_MODE_HELP, costWithTaxesCents, formatPercent, ivaLabel, margin, taxRate, unitById } from '@/domain/catalog';
import { deleteProducts, getProduct } from '@/repos/products';
import { formatDateTime, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Tabla sin marco de las tarjetas del detalle: encabezado 14/600 con línea inferior. */
function PlainTable({ head, children, className }: { head: React.ReactNode[]; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            {head.map((h, i) => (
              <th key={i} scope="col" className="whitespace-nowrap py-3 pr-6 align-bottom font-semibold text-gray-900">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm text-gray-600">{label}</p>
      <p className="mt-0.5 text-lg font-medium text-gray-900">{value}</p>
      <p className="mt-0.5 text-xs text-gray-500">{sub}</p>
    </div>
  );
}

/** Detalle del producto (D-product-detail.png). */
export function ProductDetailPage() {
  const db = useDb();
  const toast = useToast();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const id = sp.get('id') ?? '';
  const p = useLiveQuery((q) => getProduct(q, id), [id]);
  const [confirm, setConfirm] = React.useState(false);

  if (p === undefined) return null;
  if (p === null)
    return (
      <Page width="narrow">
        <PageHeader back="/products" title="Detalle del Producto" />
        <Card>
          <EmptyState title="Producto no encontrado" description="Es posible que se haya eliminado." />
        </Card>
      </Page>
    );

  const unit = unitById(p.unit);
  const rate = taxRate({ chargeTaxes: !!p.charge_taxes, iva: p.iva, ieps: p.ieps });
  const cost = costWithTaxesCents(p.cost_cents, p.cost_mode, rate);
  const mainPrice = p.prices[0]?.price_cents ?? 0;
  const stock = p.stock.reduce((s, l) => s + l.quantity, 0);
  const extras = [
    ['Categoría', p.category_name],
    ['Marca', p.brand_name],
    ['Código de barras', p.barcode],
    ['Ubicación', p.shelf_location],
    ['Clave SAT', p.sat_key],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <Page width="narrow">
      <PageHeader
        back="/products"
        title="Detalle del Producto"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirm(true)}>
              <Trash2 />
              Eliminar
            </Button>
            <Button variant="primary" asChild>
              <Link to={`/products/edit?id=${p.id}`}>
                <Pencil />
                Editar
              </Link>
            </Button>
          </>
        }
      />
      <div className="space-y-4">
        <Card className="flex gap-6 p-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h3 className="font-display text-xl font-bold text-gray-900">{p.name}</h3>
              {p.type === 'service' && <Badge tone="info">Servicio</Badge>}
              {!p.sell_in_pos && <Badge>No se vende en el punto de venta</Badge>}
            </div>
            {p.sku && <p className="mt-1 text-xs text-gray-600">SKU: {p.sku}</p>}
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-4">
              <Stat label="Precio" value={formatMoney(mainPrice / 100)} sub={p.charge_taxes ? `IVA ${ivaLabel(p.iva)}` : 'Sin impuestos'} />
              <Stat label="Costo" value={formatMoney(p.cost_cents / 100)} sub={COST_MODE_HELP[p.cost_mode]} />
              {p.track_stock ? <Stat label="Existencias" value={String(stock)} sub={unit.label} /> : null}
            </div>
            {p.description && (
              <div className="mt-6">
                <p className="text-xs text-gray-600">Descripción</p>
                <p className="mt-1 whitespace-pre-line text-sm text-gray-900">{p.description}</p>
              </div>
            )}
            {extras.length > 0 && (
              <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                {extras.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-gray-600">{k}</dt>
                    <dd className="mt-0.5 text-sm text-gray-900">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {p.requires_prescription ? <p className="mt-6 text-sm text-gray-700">Requiere receta médica para su venta</p> : null}
          </div>
          <Thumb src={p.image ?? undefined} size={220} className="rounded-md [&>svg]:size-1/2 [&>svg]:text-gray-200" />
        </Card>

        {p.track_stock ? (
          <Card className="px-6 pb-2 pt-2">
            <PlainTable head={['Ubicación', 'Existencias', 'Cantidad Mínima']}>
              {p.stock.map((s) => (
                <tr key={s.location_id}>
                  <td className="py-4 pr-6 text-gray-900">{s.location_name}</td>
                  <td className="py-4 pr-6 text-gray-900">{s.quantity}</td>
                  <td className="py-4 pr-6 text-gray-900">{s.min_quantity}</td>
                </tr>
              ))}
            </PlainTable>
          </Card>
        ) : null}

        <Card className="px-6 pb-2 pt-2">
          <PlainTable
            head={[
              'Lista de Precios',
              <>
                Precio de Venta
                <span className="block text-xs font-normal text-gray-600">(Impuestos Incluidos)</span>
              </>,
              'Margen',
              'Ganancia',
            ]}
          >
            {p.prices.map((l) => {
              const price = l.price_cents ?? 0;
              const m = margin(price, cost);
              return (
                <tr key={l.price_list_id}>
                  <td className="py-4 pr-6 font-medium text-gray-900">{l.name}</td>
                  <td className="py-4 pr-6 text-gray-900">{formatMoney(price / 100)}</td>
                  <td className="py-4 pr-6 text-gray-500">{formatPercent(m.ratio)}</td>
                  <td className="py-4 pr-6 text-gray-500">{formatMoney(m.profitCents / 100)}</td>
                </tr>
              );
            })}
          </PlainTable>
        </Card>

        {p.track_stock ? (
          <Card className="p-6">
            <h4 className="text-sm font-medium text-gray-600">Últimos Movimientos</h4>
            {p.movements.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">Este producto aún no tiene movimientos de inventario.</p>
            ) : (
              <PlainTable className="mt-4" head={['Fecha', 'Movimiento', 'Stock Anterior', 'Tipo', 'Cantidad', 'Nuevo Stock', 'Ubicación', 'Usuario']}>
                {p.movements.map((m) => {
                  const entry = m.quantity > 0;
                  return (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap py-4 pr-6 text-gray-600">{formatDateTime(new Date(m.created_at))}</td>
                      <td className="whitespace-nowrap py-4 pr-6 text-gray-900">{m.description}</td>
                      <td className="py-4 pr-6 text-gray-900">{m.stock_before}</td>
                      <td className="py-4 pr-6">
                        <Badge tone={entry ? 'success' : 'danger'}>
                          {entry ? <ArrowUp /> : <ArrowDown />}
                          {entry ? 'Entrada' : 'Salida'}
                        </Badge>
                      </td>
                      <td className={cn('py-4 pr-6', entry ? 'text-green-600' : 'text-red-600')}>{entry ? `+${m.quantity}` : m.quantity}</td>
                      <td className="py-4 pr-6 text-gray-900">{m.stock_after}</td>
                      <td className="whitespace-nowrap py-4 pr-6 text-gray-600">{m.location_name}</td>
                      <td className="whitespace-nowrap py-4 pr-6 text-gray-600">{m.user_name}</td>
                    </tr>
                  );
                })}
              </PlainTable>
            )}
          </Card>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Eliminar producto"
        description={
          <>
            <span className="font-medium text-gray-900">{p.name}</span> dejará de aparecer en el catálogo y en el punto de venta. Su historial de movimientos y ventas se conserva.
          </>
        }
        confirmLabel="Eliminar"
        onConfirm={async () => {
          try {
            await db.write((tx) => deleteProducts(tx, [p.id]));
            toast.success('Producto eliminado');
            navigate('/products', { replace: true });
          } catch (e) {
            toast.error(e);
          }
        }}
      />
    </Page>
  );
}
