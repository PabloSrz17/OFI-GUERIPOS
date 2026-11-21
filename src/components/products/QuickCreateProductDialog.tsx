import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, InputGroup } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { useToast } from '@/components/ui/feedback';
import { useDb, useLiveQuery } from '@/db/hooks';
import { listPriceLists } from '@/repos/categories';
import { createProduct, type ProductType } from '@/repos/products';
import { ValidationError } from '@/repos/common';
import { emptyProductForm, inputFromForm, type ProductFormState } from './product-form';
import { CategoryCombobox } from './RefComboboxes';
import { CostModeSelect } from './CostModeSelect';
import { COST_MODE_HELP } from '@/domain/catalog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType?: ProductType;
  onCreated?: (id: string) => void;
  /** Nombre precargado ("Crear producto «texto buscado»" del POS). */
  initialName?: string;
}

/** "Crear Producto Rápido" (D-product-new-form.png): cuerpo gris, dos tarjetas, "Ir al Editor Completo" conservando lo escrito. */
export function QuickCreateProductDialog({ open, onOpenChange, initialType = 'product', onCreated, initialName = '' }: Props) {
  const db = useDb();
  const toast = useToast();
  const navigate = useNavigate();
  const lists = useLiveQuery(listPriceLists, []) ?? [];
  const [form, setForm] = React.useState<ProductFormState>(() => emptyProductForm(initialType));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const nameRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setForm({ ...emptyProductForm(initialType), name: initialName });
      setErrors({});
    }
  }, [open, initialType, initialName]);

  const set = <K extends keyof ProductFormState>(k: K, v: ProductFormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };
  const publico = lists[0]?.id;
  const isService = form.type === 'service';

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!form.name.trim() || busy) return;
    setBusy(true);
    try {
      const id = await db.write((tx) => createProduct(tx, inputFromForm(form)));
      toast.success(isService ? 'Servicio creado' : 'Producto creado');
      onOpenChange(false);
      onCreated?.(id);
    } catch (err) {
      if (err instanceof ValidationError && err.field) setErrors({ [err.field]: err.message });
      else toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Crear Producto Rápido"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          nameRef.current?.focus();
        }}
        size="lg"
        bodyTone="gray"
        bodyClassName="space-y-4"
        beforeFooter={
          <Button
            variant="soft"
            className="w-full"
            onClick={() => {
              onOpenChange(false);
              navigate('/products/add', { state: { form } });
            }}
          >
            Ir al Editor Completo
            <ChevronRight />
          </Button>
        }
        footer={
          <>
            <DialogClose asChild>
              <Button>Cancelar</Button>
            </DialogClose>
            <Button variant="primary" disabled={!form.name.trim() || busy} onClick={() => submit()}>
              Crear Producto
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-5 rounded-lg bg-white p-6 shadow-card">
            <Field label="Tipo">
              <Segmented
                aria-label="Tipo"
                variant="outline"
                value={form.type}
                onChange={(v) => set('type', v)}
                options={[
                  { value: 'product', label: 'Producto' },
                  { value: 'service', label: 'Servicio' },
                ]}
              />
            </Field>
            <div className="grid grid-cols-2 gap-6">
              <Field label="Nombre" required htmlFor="qc-name" error={errors.name}>
                <Input ref={nameRef} id="qc-name" placeholder="Ej: Jabón de mano" value={form.name} aria-invalid={!!errors.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
              {!isService ? (
                <Field label="Existencias" htmlFor="qc-stock">
                  <InputGroup id="qc-stock" type="number" inputMode="decimal" placeholder="0" suffix="Unidad" value={form.initialStock} onChange={(e) => set('initialStock', e.target.value)} />
                </Field>
              ) : (
                <div />
              )}
              <Field label="Código de barras" htmlFor="qc-barcode" error={errors.barcode}>
                <Input id="qc-barcode" placeholder="Opcional" value={form.barcode} aria-invalid={!!errors.barcode} onChange={(e) => set('barcode', e.target.value)} />
              </Field>
              <Field label="Categoría" htmlFor="qc-category">
                <CategoryCombobox id="qc-category" value={form.category} onChange={(v) => set('category', v)} />
              </Field>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-6 rounded-lg bg-white p-6 shadow-card">
            <Field label="Precio de venta" htmlFor="qc-price" help="Incluyendo impuestos" error={errors.price}>
              <InputGroup
                id="qc-price"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                prefix="$"
                placeholder="0.00"
                suffix="por Unidad"
                value={publico ? (form.prices[publico] ?? '') : ''}
                onChange={(e) => publico && set('prices', { ...form.prices, [publico]: e.target.value })}
              />
            </Field>
            <Field label="Costo" htmlFor="qc-cost" help={COST_MODE_HELP[form.costMode]} labelAddon={<CostModeSelect value={form.costMode} onChange={(v) => set('costMode', v)} />} error={errors.cost}>
              <InputGroup id="qc-cost" type="number" inputMode="decimal" min={0} step="0.01" prefix="$" placeholder="0.00" suffix="por Unidad" value={form.cost} onChange={(e) => set('cost', e.target.value)} />
            </Field>
          </div>
          <p className="px-1 text-sm text-gray-500">
            <span className="font-medium text-gray-700">Más Opciones:</span> Para editar Impuestos, Unidades, Marca, SKU, Existencias mínimas, etc., ir al editor completo
          </p>
          {/* Enter en cualquier campo crea el producto. */}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
