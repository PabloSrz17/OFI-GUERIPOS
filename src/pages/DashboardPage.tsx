import { Link } from 'react-router-dom';
import { Calculator, PackagePlus, ShoppingCart } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AreaChart, type AreaPoint } from '@/components/charts/area-chart';
import { formatMoney, formatMoneyShort } from '@/lib/format';
import { cn } from '@/lib/utils';

// Etapa 2: datos de demostración para validar el diseño. Se conectan a SQLite en la Etapa 7.
const DEMO_SALES: AreaPoint[] = [
  { label: '15 nov', value: 0 },
  { label: '16 nov', value: 22 },
  { label: '17 nov', value: 22 },
  { label: '18 nov', value: 18 },
  { label: '19 nov', value: 22 },
  { label: '20 nov', value: 14 },
  { label: '21 nov', value: 15 },
];
const DEMO_REVENUE: AreaPoint[] = [0, 36151, 31603.5, 11383.1, 19108.5, 7813, 9339].map((value, i) => ({ label: DEMO_SALES[i].label, value }));

const QUICK_ACTIONS = [
  { label: 'Nueva Venta', to: '/pos', icon: ShoppingCart, tone: 'bg-emerald-50 text-emerald-600' },
  { label: 'Crear Producto', to: '/products?new=1', icon: PackagePlus, tone: 'bg-amber-50 text-amber-600' },
  { label: 'Hacer Corte de Caja', to: '/cash', icon: Calculator, tone: 'bg-sky-50 text-sky-600' },
];

function KpiCard({ title, value, data, money }: { title: string; value: string; data: AreaPoint[]; money?: boolean }) {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between">
        <h3 className="text-base font-medium text-gray-900">{title}</h3>
        <Link to="/reports" className="text-sm font-medium text-sky-600 hover:text-sky-700">
          Ver reporte
        </Link>
      </div>
      <p className="mt-2 text-3xl font-semibold text-gray-900">{value}</p>
      <AreaChart
        className="mt-4"
        height={230}
        data={data}
        aria-label={`${title} de los últimos 7 días`}
        formatY={money ? formatMoneyShort : String}
        formatValue={money ? formatMoney : (v) => `${v} ventas`}
      />
    </Card>
  );
}

export function DashboardPage() {
  const totalSales = DEMO_SALES.reduce((s, p) => s + p.value, 0);
  const totalRevenue = DEMO_REVENUE.reduce((s, p) => s + p.value, 0);
  return (
    <div className="mx-auto max-w-[958px] px-6 pb-10">
      <div className="flex items-center gap-3 py-6">
        <h2 className="font-display text-2xl font-extrabold text-gray-900">¡Hola!</h2>
        <Badge tone="warning">Datos de demostración</Badge>
      </div>

      <ul className="grid grid-cols-3 gap-4">
        {QUICK_ACTIONS.map(({ label, to, icon: Icon, tone }) => (
          <li key={label}>
            <Link
              to={to}
              className="flex h-[100px] flex-col items-center justify-center gap-3 rounded-lg bg-white shadow-card transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              <span className="text-sm font-medium text-gray-900">{label}</span>
              <span className={cn('flex size-10 items-center justify-center rounded-lg', tone)}>
                <Icon className="size-5" />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <hr className="my-6 border-gray-200" />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <KpiCard title="Ventas" value={String(totalSales)} data={DEMO_SALES} />
        <KpiCard title="Facturación" value={formatMoney(totalRevenue).replace(/\.\d\d$/, '')} data={DEMO_REVENUE} money />
      </div>

      <div className="mt-6 flex justify-center">
        <Button asChild>
          <Link to="/reports">Ver Todos los Reportes</Link>
        </Button>
      </div>
    </div>
  );
}
