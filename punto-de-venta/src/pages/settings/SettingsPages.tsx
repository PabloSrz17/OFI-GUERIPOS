import * as React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Archive, ChevronRight, Plus, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Thumb } from '@/components/ui/misc';
import { ConfirmDialog, useToast } from '@/components/ui/feedback';
import { CategoryDialog } from '@/components/products/CategoryDialog';
import { useDb, useLiveQuery } from '@/db/hooks';
import { deleteCategory, listCategories, type Category } from '@/repos/categories';
import { cn } from '@/lib/utils';

/** Secciones de Preferencias incluidas en esta app (Pulpos tiene más; ver navigation.md). */
const SETTINGS_NAV = [
  { label: 'Tickets', to: '/settings/tickets', match: ['/settings/tickets'] },
  { label: 'Productos', to: '/settings/products', match: ['/settings/products', '/settings/product-'] },
  { label: 'Clientes', to: '/settings/clients', match: ['/settings/clients'] },
  { label: 'Respaldo', to: '/settings/backup', match: ['/settings/backup'] },
  { label: 'Acceso', to: '/settings/access', match: ['/settings/access'] },
];

/** Columna secundaria "PREFERENCIAS" (E-settings-products.png) + contenido centrado de 712px. */
export function SettingsLayout() {
  const { pathname } = useLocation();
  const active = (prefixes: string[]) => prefixes.some((p) => pathname.startsWith(p));
  return (
    <div className="flex min-h-full">
      <nav aria-label="Preferencias" className="w-[241px] shrink-0 border-r border-gray-200 bg-white py-6">
        <p className="px-7 pb-4 pt-2 text-sm font-medium uppercase text-gray-400">Preferencias</p>
        <ul>
          {SETTINGS_NAV.map((i) => (
            <li key={i.to}>
              <Link
                to={i.to}
                aria-current={active(i.match) ? 'page' : undefined}
                className={cn('relative block px-7 py-3 text-sm', active(i.match) ? 'font-semibold text-gray-900' : 'text-gray-700 hover:text-gray-900')}
              >
                {active(i.match) && <span aria-hidden="true" className="absolute inset-y-1 left-0 w-1 rounded-r bg-primary-light" />}
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1 px-6 pb-10">
        <div className="mx-auto max-w-[712px]">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

const PRODUCT_SETTINGS = [{ label: 'Categorías', to: '/settings/product-categories', icon: Archive }];

export function SettingsProductsPage() {
  return (
    <>
      <PageHeader title="Productos" />
      <Card className="overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-4 text-sm font-semibold text-gray-900">Productos</div>
        <ul className="divide-y divide-gray-200">
          {PRODUCT_SETTINGS.map(({ label, to, icon: Icon }) => (
            <li key={to}>
              <Link to={to} className="flex items-center gap-3 px-6 py-4 hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none">
                <span className="flex size-12 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                  <Icon className="size-5" />
                </span>
                <span className="flex-1 text-sm font-semibold text-gray-700">{label}</span>
                <ChevronRight className="size-5 text-gray-500" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

/** Categorías de Productos (E-categories-list.png). */
export function CategoriesPage() {
  const db = useDb();
  const toast = useToast();
  const categories = useLiveQuery(listCategories, []);
  const [dialog, setDialog] = React.useState<{ open: boolean; category: Category | null }>({ open: false, category: null });
  const [toDelete, setToDelete] = React.useState<Category | null>(null);
  const openNew = () => setDialog({ open: true, category: null });

  return (
    <>
      <PageHeader
        back="/settings/products"
        title="Categorías de Productos"
        actions={
          <Button variant="primary" onClick={openNew}>
            <Plus />
            Agregar Categoría
          </Button>
        }
      />
      <Card className="overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-3.5 text-left font-semibold text-gray-900">
                Categoría
              </th>
              <th scope="col" className="px-3 py-3.5 text-left font-semibold text-gray-900">
                Cantidad de Productos
              </th>
              <th scope="col">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 border-t border-gray-200">
            {(categories ?? []).map((c) => (
              <tr key={c.id}>
                <td className="px-6 py-3">
                  <div className="flex items-center gap-3">
                    <Thumb src={c.image ?? undefined} />
                    <span className="text-gray-900">{c.name}</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-gray-500">{c.product_count}</td>
                <td className="px-6 py-3">
                  <div className="flex items-center justify-end gap-4">
                    <Button variant="link" onClick={() => setDialog({ open: true, category: c })} aria-label={`Editar ${c.name}`}>
                      Editar
                    </Button>
                    <button type="button" aria-label={`Eliminar ${c.name}`} onClick={() => setToDelete(c)} className="rounded p-1 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                      <X className="size-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} className="px-4 py-4">
                <Button variant="link" onClick={openNew}>
                  <Plus />
                  Agregar Categoría
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </Card>

      <CategoryDialog open={dialog.open} category={dialog.category} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Eliminar categoría"
        description={
          toDelete && (
            <>
              Se eliminará <span className="font-medium text-gray-900">{toDelete.name}</span>.
              {toDelete.product_count > 0 && ` Sus ${toDelete.product_count} ${toDelete.product_count === 1 ? 'producto quedará' : 'productos quedarán'} "Sin Categoría".`}
            </>
          )
        }
        confirmLabel="Eliminar"
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await db.write((tx) => deleteCategory(tx, toDelete.id));
            toast.success('Categoría eliminada');
          } catch (e) {
            toast.error(e);
          }
        }}
      />
    </>
  );
}
