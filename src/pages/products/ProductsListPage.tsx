import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, Briefcase, ChevronDown, Download, Search, Tag, Trash2 } from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { StockBadge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { InputGroup } from '@/components/ui/input';
import { EmptyState, Thumb } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ConfirmDialog, useToast } from '@/components/ui/feedback';
import { QuickCreateProductDialog } from '@/components/products/QuickCreateProductDialog';
import { ProductFiltersDialog } from '@/components/products/ProductFiltersDialog';
import { useDb, useLiveQuery } from '@/db/hooks';
import { deleteProducts, listProducts, productsCsv, type ProductFilters, type ProductSort, type ProductType } from '@/repos/products';
import { quantityUnit } from '@/domain/catalog';
import { formatMoney, formatQuantity } from '@/lib/format';
import { download } from '@/lib/download';

export const PAGE_SIZE = 25;

const SORT_OPTIONS: { value: ProductSort; label: string }[] = [
  { value: 'name-asc', label: 'Nombre (A - Z)' },
  { value: 'name-desc', label: 'Nombre (Z - A)' },
  { value: 'sku-asc', label: 'SKU (A - Z)' },
  { value: 'sku-desc', label: 'SKU (Z - A)' },
  { value: 'category-asc', label: 'Categoría (A - Z)' },
  { value: 'category-desc', label: 'Categoría (Z - A)' },
  { value: 'stock-asc', label: 'Menos Stock' },
  { value: 'stock-desc', label: 'Mayor Stock' },
  { value: 'created-asc', label: 'Creación (antiguos primero)' },
  { value: 'created-desc', label: 'Creación (recientes primero)' },
];

// Los filtros viven en la URL (como en Pulpos: ?q=…&p=1…), así "Regresar" desde el detalle conserva la vista.
const FILTER_PARAMS: Record<keyof ProductFilters, string> = { categoryId: 'cat', brandId: 'brand', type: 'type', barcode: 'barcode', pos: 'pos', prescription: 'rx', stock: 'stock' };

function readFilters(sp: URLSearchParams): ProductFilters {
  const f: Record<string, string> = {};
  for (const [k, p] of Object.entries(FILTER_PARAMS)) {
    const v = sp.get(p);
    if (v) f[k] = v;
  }
  return f as ProductFilters;
}

function AddProductMenu({ onNew }: { onNew: (t: ProductType) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="primary">
          Agregar Producto
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80 py-0">
        <DropdownMenuItem icon={<Tag />} description="Añade un producto a tu negocio" onSelect={() => onNew('product')}>
          Nuevo Producto
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Briefcase />} description="Ofrece un servicio a tus clientes" onSelect={() => onNew('service')}>
          Nuevo Servicio
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProductsListPage() {
  const db = useDb();
  const toast = useToast();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const page = Number(sp.get('p') ?? '1') || 1;
  const sort = (sp.get('sort') as ProductSort) || 'name-asc';
  const filters = React.useMemo(() => readFilters(sp), [sp]);
  const [search, setSearch] = React.useState(q);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [quick, setQuick] = React.useState<{ open: boolean; type: ProductType }>({ open: sp.get('new') === '1', type: 'product' });

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

  // "Crear Producto" del dashboard llega con ?new=1: se abre el modal y se limpia la URL.
  React.useEffect(() => {
    if (sp.get('new') === '1') update({ new: null });
  }, [sp, update]);

  // Búsqueda mientras se escribe (con una pausa corta para no consultar en cada tecla).
  React.useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => update({ q: search.trim() || null, p: null }), 200);
    return () => clearTimeout(t);
  }, [search, q, update]);

  const result = useLiveQuery((tx) => listProducts(tx, { q, sort, filters, page, pageSize: PAGE_SIZE }), [q, sort, filters, page]);
  const rows = result?.rows ?? [];
  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const filtered = q !== '' || Object.keys(filters).length > 0;

  function applyFilters(f: ProductFilters) {
    const patch: Record<string, string | null> = { p: null };
    for (const [k, p] of Object.entries(FILTER_PARAMS)) patch[p] = (f as Record<string, string | undefined>)[k] ?? null;
    update(patch);
  }

  return (
    <Page>
      <PageHeader
        title="Productos"
        actions={
          <>
            <Button onClick={async () => download('productos.csv', await db.read(productsCsv))}>
              <Download />
              Descargar Productos
            </Button>
            <AddProductMenu onNew={(type) => setQuick({ open: true, type })} />
          </>
        }
      />
      <Card className="p-6">
        <div className="flex gap-4">
          <div className="flex-1">
            <InputGroup icon={<Search />} placeholder="Buscar por nombre, SKU o código de barras" aria-label="Buscar productos" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <ProductFiltersDialog value={filters} onApply={applyFilters} />
          <Select aria-label="Ordenar" value={sort} onValueChange={(v) => update({ sort: v === 'name-asc' ? null : v, p: null })} icon={<ArrowDownUp className="size-4" />} triggerLabel="Ordenar" options={SORT_OPTIONS} />
        </div>

        {selected.size > 0 && (
          <div className="mt-4 flex items-center gap-4 rounded-lg bg-sky-50 px-4 py-2 text-sm text-sky-800">
            <span className="font-medium">
              {selected.size} {selected.size === 1 ? 'producto seleccionado' : 'productos seleccionados'}
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
            <EmptyState className="mt-4" muted title="No se encontraron productos para esta búsqueda" />
          ) : (
            <EmptyState
              className="mt-4"
              title="Aún no tienes productos"
              description="Agrega tu primer producto para empezar a vender."
              actions={
                <Button variant="primary" onClick={() => setQuick({ open: true, type: 'product' })}>
                  Agregar Producto
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
                  <TH>Producto</TH>
                  <TH align="center">Stock</TH>
                  <TH align="center">Categoría</TH>
                  <TH align="center">Precio</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((p) => (
                  <TR key={p.id} interactive className="cursor-pointer" onClick={() => navigate(`/products/detail?id=${p.id}`)}>
                    <TD className="pl-6" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        aria-label={`Seleccionar ${p.name}`}
                        checked={selected.has(p.id)}
                        onCheckedChange={() =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (n.has(p.id)) n.delete(p.id);
                            else n.add(p.id);
                            return n;
                          })
                        }
                      />
                    </TD>
                    <TD>
                      <div className="flex items-center gap-3">
                        <Thumb src={p.image ?? undefined} />
                        <div className="min-w-0">
                          <Link to={`/products/detail?id=${p.id}`} onClick={(e) => e.stopPropagation()} className="text-sm font-medium text-sky-600 hover:text-sky-700">
                            {p.name}
                          </Link>
                          {p.sku && <p className="text-xs text-gray-500">{p.sku}</p>}
                        </div>
                      </div>
                    </TD>
                    <TD align="center">{p.track_stock ? <StockBadge quantity={p.stock ?? 0} label={formatQuantity(p.stock ?? 0, quantityUnit(p.unit))} /> : <span className="text-gray-400">—</span>}</TD>
                    <TD align="center">{p.category_name}</TD>
                    <TD align="center">{formatMoney((p.price_cents ?? 0) / 100)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {result && result.totalPages > 1 && <Pagination className="mt-6" page={result.page} totalPages={result.totalPages} onPageChange={(n) => update({ p: n === 1 ? null : String(n) })} />}
          </>
        )}
      </Card>

      <QuickCreateProductDialog open={quick.open} initialType={quick.type} onOpenChange={(open) => setQuick((s) => ({ ...s, open }))} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={selected.size === 1 ? 'Eliminar producto' : `Eliminar ${selected.size} productos`}
        description="Dejarán de aparecer en el catálogo y en el punto de venta. Su historial de movimientos y ventas se conserva."
        confirmLabel="Eliminar"
        onConfirm={async () => {
          try {
            const n = await db.write((tx) => deleteProducts(tx, [...selected]));
            setSelected(new Set());
            toast.success(n === 1 ? 'Producto eliminado' : `${n} productos eliminados`);
          } catch (e) {
            toast.error(e);
          }
        }}
      />
    </Page>
  );
}
