import * as React from 'react';
import { useBlocker, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CircleHelp, Plus } from 'lucide-react';
import { Page, PageFooterBar, PageHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { CheckboxField } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, InputGroup, Textarea } from '@/components/ui/input';
import { ImagePicker } from '@/components/ui/image-picker';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/feedback';
import { EmptyState } from '@/components/ui/misc';
import { CostModeSelect } from '@/components/products/CostModeSelect';
import { BrandCombobox, CategoryCombobox } from '@/components/products/RefComboboxes';
import { emptyProductForm, formFromProduct, inputFromForm, isDirty, type ProductFormState } from '@/components/products/product-form';
import { useDb, useLiveQuery } from '@/db/hooks';
import { COST_MODE_HELP, costWithTaxesCents, formatPercent, IEPS_OPTIONS, IVA_OPTIONS, margin, parseMoneyToCents, taxRate, unitById, UNITS } from '@/domain/catalog';
import { createPriceList, listPriceLists } from '@/repos/categories';
import { createProduct, getProduct, updateProduct } from '@/repos/products';
import { ValidationError } from '@/repos/common';
import { formatMoney } from '@/lib/format';

function Help({ text }: { text: string }) {
  return (
    <span title={text} aria-label={text} className="inline-flex text-gray-400">
      <CircleHelp className="size-4" />
    </span>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <div className="p-6">
        <CardTitle className="mb-6">{title}</CardTitle>
        {children}
      </div>
    </Card>
  );
}

/** "Tienes cambios sin guardar" (D-product-unsaved-dialog.png). */
function UnsavedDialog({ open, onStay, onLeave }: { open: boolean; onStay: () => void; onLeave: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onStay()}>
      <DialogContent
        title="Tienes cambios sin guardar"
        size="sm"
        footer={
          <>
            <Button onClick={onStay}>Continuar Editando</Button>
            <Button variant="primary" onClick={onLeave}>
              Salir sin Guardar
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">Al salir de esta sección se perderán todos los cambios no guardados</p>
      </DialogContent>
    </Dialog>
  );
}

function NewPriceListDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const db = useDb();
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setName('');
      setError(null);
    }
  }, [open]);
  async function save() {
    try {
      await db.write((tx) => createPriceList(tx, name));
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Agregar Lista de Precios"
        description="La lista queda disponible para todos los productos."
        size="sm"
        footer={
          <>
            <DialogClose asChild>
              <Button>Cancelar</Button>
            </DialogClose>
            <Button variant="primary" disabled={!name.trim()} onClick={save}>
              Crear Lista
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save();
          }}
        >
          <Field label="Nombre de la lista" htmlFor="pl-name" error={error}>
            <Input id="pl-name" autoFocus placeholder="Ej: Mayoreo" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Editor completo (D-product-full-editor.png) para /products/add y /products/edit?id=… */
export function ProductEditorPage({ mode }: { mode: 'add' | 'edit' }) {
  const [sp] = useSearchParams();
  const id = sp.get('id');
  const product = useLiveQuery((q) => (mode === 'edit' && id ? getProduct(q, id) : null), [mode, id]);
  if (mode === 'edit' && product === undefined) return null;
  if (mode === 'edit' && !product)
    return (
      <Page width="narrow">
        <PageHeader back="/products" title="Editar Producto" />
        <Card>
          <EmptyState title="Producto no encontrado" description="Es posible que se haya eliminado." />
        </Card>
      </Page>
    );
  return <ProductEditor key={product?.id ?? 'new'} mode={mode} initial={product ? formFromProduct(product) : undefined} productId={product?.id} currentStock={product?.stock[0]?.quantity ?? 0} />;
}

function ProductEditor({ mode, initial, productId, currentStock }: { mode: 'add' | 'edit'; initial?: ProductFormState; productId?: string; currentStock: number }) {
  const db = useDb();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const lists = useLiveQuery(listPriceLists, []) ?? [];
  // Desde "Ir al Editor Completo" llega el formulario del modal para conservar lo escrito.
  const start = React.useMemo<ProductFormState>(() => initial ?? (location.state as { form?: ProductFormState } | null)?.form ?? emptyProductForm(), [initial, location.state]);
  const [form, setForm] = React.useState<ProductFormState>(start);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [newList, setNewList] = React.useState(false);
  const done = React.useRef(false);

  const dirty = isDirty(form, mode === 'add' ? emptyProductForm() : start);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !done.current && currentLocation.pathname !== nextLocation.pathname);

  const set = <K extends keyof ProductFormState>(k: K, v: ProductFormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };
  const isService = form.type === 'service';
  const unit = unitById(form.unit);
  const rate = taxRate(form);
  const costCents = costWithTaxesCents(parseMoneyToCents(form.cost), form.costMode, rate);

  async function save() {
    if (!form.name.trim()) {
      setErrors({ name: 'Indica el nombre del producto' });
      document.getElementById('pe-name')?.focus();
      return;
    }
    setSaving(true);
    try {
      const savedId = await db.write((tx) => {
        const input = inputFromForm(form);
        if (mode === 'edit' && productId) {
          updateProduct(tx, productId, input);
          return productId;
        }
        return createProduct(tx, input);
      });
      done.current = true;
      toast.success(mode === 'edit' ? 'Cambios guardados' : isService ? 'Servicio creado' : 'Producto creado');
      navigate(`/products/detail?id=${savedId}`, { replace: true });
    } catch (err) {
      if (err instanceof ValidationError && err.field) {
        setErrors({ [err.field]: err.message });
        document.getElementById(`pe-${err.field}`)?.focus();
      } else toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  const backTo = mode === 'edit' && productId ? `/products/detail?id=${productId}` : '/products';

  return (
    <>
      <Page width="narrow">
        <PageHeader back={backTo} title={mode === 'edit' ? 'Editar Producto' : 'Agregar Producto'} />
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Section title="Datos del Producto">
              <div className="space-y-6">
                <Field label="Nombre del producto" required htmlFor="pe-name" error={errors.name}>
                  <Input id="pe-name" autoFocus={mode === 'add'} placeholder="Ej: Jabón de mano" value={form.name} aria-invalid={!!errors.name} onChange={(e) => set('name', e.target.value)} />
                </Field>
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
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Código de barras" htmlFor="pe-barcode" labelAddon={<Help text="El código que lee el escáner en el punto de venta" />} error={errors.barcode}>
                    <Input id="pe-barcode" placeholder="Opcional" value={form.barcode} aria-invalid={!!errors.barcode} onChange={(e) => set('barcode', e.target.value)} />
                  </Field>
                  <Field label="SKU" htmlFor="pe-sku" labelAddon={<Help text="Clave interna para identificar el producto" />} error={errors.sku}>
                    <Input id="pe-sku" placeholder="Opcional" value={form.sku} aria-invalid={!!errors.sku} onChange={(e) => set('sku', e.target.value)} />
                  </Field>
                </div>
                <div className="space-y-3">
                  <CheckboxField
                    id="pe-pos"
                    label={
                      <span className="inline-flex items-center gap-2">
                        Vender en el Punto de Venta <Help text="Si se desmarca, el producto no aparece en el punto de venta" />
                      </span>
                    }
                    checked={form.sellInPos}
                    onCheckedChange={(v) => set('sellInPos', v === true)}
                  />
                  <CheckboxField id="pe-rx" label="Requerir receta médica para su venta" checked={form.requiresPrescription} onCheckedChange={(v) => set('requiresPrescription', v === true)} />
                </div>
              </div>
            </Section>
            <Section title="Imágenes">
              <ImagePicker className="h-[256px]" value={form.image} onChange={(v) => set('image', v)} onError={toast.error} />
            </Section>
          </div>

          <Section title="Datos Adicionales">
            <div className="grid grid-cols-3 gap-6">
              <Field label="Unidad de venta" htmlFor="pe-unit">
                <Select
                  id="pe-unit"
                  aria-label="Unidad de venta"
                  className="w-full"
                  value={form.unit}
                  onValueChange={(v) => set('unit', v)}
                  options={UNITS.map((u) => ({ value: u.id, label: u.label }))}
                />
              </Field>
              <Field label="Categoría" htmlFor="pe-category">
                <CategoryCombobox id="pe-category" value={form.category} onChange={(v) => set('category', v)} />
              </Field>
              <Field label="Marca" htmlFor="pe-brand" error={errors.brand}>
                <BrandCombobox id="pe-brand" value={form.brand} onChange={(v) => set('brand', v)} />
              </Field>
              <Field label="Ubicación" htmlFor="pe-shelf">
                <Input id="pe-shelf" placeholder="Ej.: Estante 3B" value={form.shelfLocation} onChange={(e) => set('shelfLocation', e.target.value)} />
              </Field>
              <Field label="Descripción" htmlFor="pe-description" className="col-span-3">
                <Textarea
                  id="pe-description"
                  placeholder="Agregar una descripción o información adicional de tu producto"
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </Field>
            </div>
          </Section>

          {!isService && (
            <Section title="Existencias">
              <CheckboxField
                id="pe-track"
                label={
                  <span className="inline-flex items-center gap-2">
                    Utilizar Existencias <Help text="Lleva el control de cuántas unidades tienes" />
                  </span>
                }
                checked={form.trackStock}
                disabled={mode === 'edit' && currentStock !== 0}
                onCheckedChange={(v) => set('trackStock', v === true)}
              />
              {form.trackStock && (
                <div className="mt-6 grid grid-cols-3 gap-6">
                  {mode === 'add' ? (
                    <Field label="Cantidad" htmlFor="pe-stock" help="Se registra como movimiento «Stock inicial»">
                      <InputGroup
                        id="pe-stock"
                        type="number"
                        inputMode="decimal"
                        placeholder="0"
                        suffix={unit.plural}
                        value={form.initialStock}
                        onChange={(e) => set('initialStock', e.target.value)}
                      />
                    </Field>
                  ) : (
                    <Field label="Cantidad" htmlFor="pe-stock" help="Para cambiarla, registra un ajuste de stock">
                      <InputGroup id="pe-stock" readOnly disabled value={String(currentStock)} suffix={unit.plural} />
                    </Field>
                  )}
                  <Field label="Cantidad mínima" htmlFor="pe-min" help="Por debajo de esta cantidad el producto requiere reposición">
                    <InputGroup id="pe-min" type="number" inputMode="decimal" min={0} placeholder="0" suffix={unit.plural} value={form.minStock} onChange={(e) => set('minStock', e.target.value)} />
                  </Field>
                </div>
              )}
            </Section>
          )}

          <Section title="Impuestos">
            <CheckboxField id="pe-taxes" label="Cobrar impuestos del producto" checked={form.chargeTaxes} onCheckedChange={(v) => set('chargeTaxes', v === true)} />
            {form.chargeTaxes && (
              <div className="mt-6 grid grid-cols-3 gap-6">
                <Field label="IVA" htmlFor="pe-iva">
                  <Select
                    id="pe-iva"
                    aria-label="IVA"
                    className="w-full"
                    value={form.iva}
                    onValueChange={(v) => set('iva', v)}
                    options={IVA_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  />
                </Field>
                <Field label="IEPS" htmlFor="pe-ieps">
                  <Select
                    id="pe-ieps"
                    aria-label="IEPS"
                    className="w-full"
                    value={form.ieps}
                    onValueChange={(v) => set('ieps', v)}
                    options={IEPS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  />
                </Field>
              </div>
            )}
          </Section>

          <Section title="Precio de Compra">
            <div className="grid grid-cols-3 gap-6">
              <Field
                label="Costo"
                htmlFor="pe-cost"
                help={COST_MODE_HELP[form.costMode]}
                labelAddon={<CostModeSelect value={form.costMode} onChange={(v) => set('costMode', v)} />}
                error={errors.cost}
              >
                <InputGroup
                  id="pe-cost"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  prefix="$"
                  placeholder="0.00"
                  suffix={`por ${unit.label}`}
                  value={form.cost}
                  onChange={(e) => set('cost', e.target.value)}
                />
              </Field>
            </div>
          </Section>

          <Section title="Precios de Venta">
            <Table>
              <THead>
                <tr>
                  <TH className="pl-4">Lista de Precios</TH>
                  <TH>
                    Precio de Venta
                    <span className="block text-xs font-normal text-gray-500">(Con Impuestos Incluidos)</span>
                  </TH>
                  <TH>Margen</TH>
                  <TH>Ganancia</TH>
                </tr>
              </THead>
              <TBody>
                {lists.map((l) => {
                  const raw = form.prices[l.id] ?? '';
                  const m = raw === '' ? null : margin(parseMoneyToCents(raw), costCents);
                  return (
                    <TR key={l.id}>
                      <TD className="pl-4 font-medium text-gray-900">{l.name}</TD>
                      <TD className="w-64">
                        <InputGroup
                          aria-label={`Precio ${l.name}`}
                          id={l === lists[0] ? 'pe-price' : undefined}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          prefix="$"
                          placeholder="0.00"
                          value={raw}
                          aria-invalid={l === lists[0] && !!errors.price}
                          onChange={(e) => set('prices', { ...form.prices, [l.id]: e.target.value })}
                        />
                      </TD>
                      <TD>{m ? formatPercent(m.ratio) : '--'}</TD>
                      <TD>{m ? formatMoney(m.profitCents / 100) : '--'}</TD>
                    </TR>
                  );
                })}
                <tr>
                  <td colSpan={4} className="px-4 py-3">
                    <Button variant="link" onClick={() => setNewList(true)}>
                      <Plus />
                      Agregar Lista de Precios
                    </Button>
                  </td>
                </tr>
              </TBody>
            </Table>
            {errors.price && <p className="mt-2 text-xs text-red-600">{errors.price}</p>}
          </Section>

          <Section title="Facturación">
            <div className="grid grid-cols-2 gap-6">
              <Field label="Clave SAT" htmlFor="pe-sat" labelAddon={<Help text="Clave de producto o servicio del catálogo del SAT" />}>
                <Input id="pe-sat" placeholder="Ingresa la clave de producto o servicio" value={form.satKey} onChange={(e) => set('satKey', e.target.value)} />
              </Field>
            </div>
          </Section>
        </div>
      </Page>
      <PageFooterBar>
        <Button onClick={() => navigate(backTo)}>Cancelar</Button>
        <Button variant="primary" disabled={saving} onClick={save}>
          {mode === 'edit' ? 'Guardar Cambios' : 'Crear Producto'}
        </Button>
      </PageFooterBar>

      <NewPriceListDialog open={newList} onOpenChange={setNewList} />
      <UnsavedDialog open={blocker.state === 'blocked'} onStay={() => blocker.reset?.()} onLeave={() => blocker.proceed?.()} />
    </>
  );
}
