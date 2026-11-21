import * as React from 'react';
import { Award, Barcode, Boxes, Folder, Monitor, Package, Stethoscope, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { ToggleChip } from '@/components/ui/misc';
import { useLiveQuery } from '@/db/hooks';
import { listBrands, listCategories } from '@/repos/categories';
import type { ProductFilters } from '@/repos/products';

export function activeFilterCount(f: ProductFilters) {
  return Object.values(f).filter(Boolean).length;
}

function Group({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white p-6 shadow-card">
      <div className="mb-3 flex items-center gap-3 text-sm font-medium text-gray-900 [&_svg]:size-5 [&_svg]:text-gray-600">
        {icon}
        {title}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chips<K extends keyof ProductFilters>({ k, options, draft, setDraft }: { k: K; options: [NonNullable<ProductFilters[K]>, string][]; draft: ProductFilters; setDraft: (f: ProductFilters) => void }) {
  return (
    <>
      {options.map(([value, label]) => (
        <ToggleChip key={String(value)} active={draft[k] === value} onClick={() => setDraft({ ...draft, [k]: draft[k] === value ? undefined : value })}>
          {label}
        </ToggleChip>
      ))}
    </>
  );
}

function SelectRow({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-3 text-sm font-medium text-gray-900 [&_svg]:size-5 [&_svg]:text-gray-600">
        {icon}
        {title}
      </span>
      {children}
    </div>
  );
}

/**
 * Modal "Filtros" (D-products-filter.png). Se omiten los grupos de funciones que esta app no tiene:
 * Catálogo en Línea, Fabricación y el tipo Kit (decisions.md D6).
 */
export function ProductFiltersDialog({ value, onApply }: { value: ProductFilters; onApply: (f: ProductFilters) => void }) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<ProductFilters>(value);
  const categories = useLiveQuery(listCategories, []) ?? [];
  const brands = useLiveQuery(listBrands, []) ?? [];
  React.useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);
  const count = activeFilterCount(draft);
  const applied = activeFilterCount(value);

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
        <div className="space-y-4 rounded-lg bg-white p-6 shadow-card">
          <SelectRow icon={<Folder />} title="Categorías">
            <Select
              aria-label="Categorías"
              className="w-60"
              value={draft.categoryId ?? 'all'}
              onValueChange={(v) => setDraft({ ...draft, categoryId: v === 'all' ? undefined : v })}
              options={[{ value: 'all', label: 'Todas las Categorías' }, { value: 'none', label: 'Sin Categoría' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
            />
          </SelectRow>
          <SelectRow icon={<Award />} title="Marcas">
            <Select
              aria-label="Marcas"
              className="w-60"
              value={draft.brandId ?? 'all'}
              onValueChange={(v) => setDraft({ ...draft, brandId: v === 'all' ? undefined : v })}
              options={[{ value: 'all', label: 'Todas las Marcas' }, ...brands.map((b) => ({ value: b.id, label: b.name }))]}
            />
          </SelectRow>
        </div>
        <Group icon={<Boxes />} title="Tipo">
          <Chips k="type" draft={draft} setDraft={setDraft} options={[['product', 'Producto'], ['service', 'Servicio']]} />
        </Group>
        <Group icon={<Barcode />} title="Código de Barras">
          <Chips k="barcode" draft={draft} setDraft={setDraft} options={[['with', 'Con código'], ['without', 'Sin código']]} />
        </Group>
        <Group icon={<Monitor />} title="Punto de Venta">
          <Chips k="pos" draft={draft} setDraft={setDraft} options={[['visible', 'Visible'], ['hidden', 'No visible']]} />
        </Group>
        <Group icon={<Stethoscope />} title="Receta">
          <Chips k="prescription" draft={draft} setDraft={setDraft} options={[['required', 'Requiere'], ['not_required', 'No requiere']]} />
        </Group>
        <Group icon={<Package />} title="Existencias">
          <Chips k="stock" draft={draft} setDraft={setDraft} options={[['in_stock', 'Con stock'], ['out_of_stock', 'Sin stock'], ['reorder', 'Requiere reposición']]} />
        </Group>
      </DialogContent>
    </Dialog>
  );
}
