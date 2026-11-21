import * as React from 'react';
import {
  ArrowDownUp,
  Barcode,
  Boxes,
  Briefcase,
  ChevronDown,
  ChevronRight,
  Download,
  Folder,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Tag,
  Trash2,
  Upload,
} from 'lucide-react';
import { Page, PageHeader, StickyFooter } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge, StockBadge } from '@/components/ui/badge';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { CheckboxField, Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field } from '@/components/ui/field';
import { Input, InputGroup } from '@/components/ui/input';
import { EmptyState, PillTabs, Shortcut, Thumb, ToggleChip } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatMoney, formatQuantity } from '@/lib/format';
import { DEMO_PRODUCTS } from './demo-data';

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-10 first:mt-0">
      <h3 className="mb-4 text-base font-semibold text-gray-900">{title}</h3>
      {children}
    </section>
  );
}

const SWATCHES = [
  ['primary', '#00A4AE', 'bg-primary'],
  ['primary-light', '#55C2C9', 'bg-primary-light'],
  ['link · sky-600', '#0284C7', 'bg-sky-600'],
  ['foco · sky-500', '#0EA5E9', 'bg-sky-500'],
  ['aside · gray-800', '#1F2937', 'bg-gray-800'],
  ['texto · gray-900', '#111827', 'bg-gray-900'],
  ['fondo · gray-100', '#F3F4F6', 'bg-gray-100'],
  ['borde · gray-200', '#E5E7EB', 'bg-gray-200'],
  ['input · gray-300', '#D1D5DB', 'bg-gray-300'],
  ['secundario · gray-500', '#6B7280', 'bg-gray-500'],
] as const;

/** Reconstrucción del patrón "Lista" (D-products-list.png). */
function ListPattern() {
  const [page, setPage] = React.useState(1);
  const [sort, setSort] = React.useState('name-asc');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const all = selected.size === DEMO_PRODUCTS.length;
  return (
    <div className="rounded-lg bg-gray-100 px-6 pb-6 ring-1 ring-gray-200">
      <PageHeader
        title="Productos"
        actions={
          <>
            <Button>
              <Barcode />
              Crear Etiquetas
            </Button>
            <Button>
              <Download />
              Descargar Productos
            </Button>
            <Button>
              <Upload />
              Importar Productos
            </Button>
            <AddProductMenu />
          </>
        }
      />
      <Card className="p-6">
        <div className="flex gap-4">
          <div className="flex-1">
            <InputGroup icon={<Search />} placeholder="Buscar por nombre, SKU o código de barras" aria-label="Buscar productos" />
          </div>
          <FiltersDialog />
          <Select
            aria-label="Ordenar"
            value={sort}
            onValueChange={setSort}
            icon={<ArrowDownUp className="size-4" />}
            triggerLabel="Ordenar"
            options={[
              { value: 'name-asc', label: 'Nombre (A - Z)' },
              { value: 'name-desc', label: 'Nombre (Z - A)' },
              { value: 'stock-asc', label: 'Menos Stock' },
              { value: 'stock-desc', label: 'Mayor Stock' },
            ]}
          />
        </div>
        <Table wrapperClassName="mt-4">
          <THead>
            <tr>
              <TH className="w-12 pl-6">
                <Checkbox aria-label="Seleccionar todos" checked={all} onCheckedChange={() => setSelected(all ? new Set() : new Set(DEMO_PRODUCTS.map((p) => p.id)))} />
              </TH>
              <TH>Producto</TH>
              <TH align="center">Stock</TH>
              <TH align="center">Categoría</TH>
              <TH align="center">Precio</TH>
            </tr>
          </THead>
          <TBody>
            {DEMO_PRODUCTS.map((p) => (
              <TR key={p.id} interactive>
                <TD className="pl-6">
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
                    <Thumb />
                    <div>
                      <a href="#" className="text-sm font-medium text-sky-600 hover:text-sky-700">
                        {p.name}
                      </a>
                      <p className="text-xs text-gray-500">{p.sku}</p>
                    </div>
                  </div>
                </TD>
                <TD align="center">
                  <StockBadge quantity={p.stock} label={formatQuantity(p.stock)} />
                </TD>
                <TD align="center">{p.category}</TD>
                <TD align="center">{formatMoney(p.price)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination className="mt-6" page={page} totalPages={29} onPageChange={setPage} />
      </Card>
    </div>
  );
}

function AddProductMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="primary">
          Agregar Producto
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80 py-0">
        <DropdownMenuItem icon={<Tag />} description="Añade un producto a tu negocio">
          Nuevo Producto
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Briefcase />} description="Ofrece un servicio a tus clientes">
          Nuevo Servicio
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Boxes />} description="Combina uno o más productos en un kit y asígnale un precio">
          Nuevo Kit de Productos
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterGroup({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
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

/** Reconstrucción del modal "Filtros" (D-products-filter.png). */
function FiltersDialog() {
  const [type, setType] = React.useState<string | null>(null);
  const [barcode, setBarcode] = React.useState<string | null>(null);
  const count = [type, barcode].filter(Boolean).length;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <SlidersHorizontal />
          Filtrar
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Filtros"
        size="md"
        bodyTone="gray"
        bodyClassName="space-y-3"
        footer={
          <>
            <Button
              onClick={() => {
                setType(null);
                setBarcode(null);
              }}
            >
              <Trash2 />
              Limpiar Filtros ({count})
            </Button>
            <DialogClose asChild>
              <Button variant="primary">Ver Resultados</Button>
            </DialogClose>
          </>
        }
      >
        <div className="space-y-4 rounded-lg bg-white p-6 shadow-card">
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-3 text-sm font-medium text-gray-900">
              <Folder className="size-5 text-gray-600" />
              Categorías
            </span>
            <Select aria-label="Categorías" className="w-60" placeholder="Todas las Categorías" options={[{ value: 'f', label: 'Ferretería' }, { value: 'c', label: 'Construcción' }]} />
          </div>
        </div>
        <FilterGroup icon={<Boxes />} title="Tipo">
          {['Producto', 'Servicio', 'Kit'].map((t) => (
            <ToggleChip key={t} active={type === t} onClick={() => setType(type === t ? null : t)}>
              {t}
            </ToggleChip>
          ))}
        </FilterGroup>
        <FilterGroup icon={<Barcode />} title="Código de Barras">
          {['Con código', 'Sin código'].map((t) => (
            <ToggleChip key={t} active={barcode === t} onClick={() => setBarcode(barcode === t ? null : t)}>
              {t}
            </ToggleChip>
          ))}
        </FilterGroup>
      </DialogContent>
    </Dialog>
  );
}

/** Reconstrucción del modal "Crear Producto Rápido" (D-product-new-form.png). */
function QuickCreateDialog() {
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState<'product' | 'service'>('product');
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Abrir "Crear Producto Rápido"</Button>
      </DialogTrigger>
      <DialogContent
        title="Crear Producto Rápido"
        size="lg"
        bodyTone="gray"
        bodyClassName="space-y-4"
        footer={
          <>
            <DialogClose asChild>
              <Button>Cancelar</Button>
            </DialogClose>
            <Button variant="primary" disabled={!name.trim()}>
              Crear Producto
            </Button>
          </>
        }
      >
        <div className="space-y-5 rounded-lg bg-white p-6 shadow-card">
          <Field label="Tipo">
            <Segmented
              variant="outline"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'product', label: 'Producto' },
                { value: 'service', label: 'Servicio' },
              ]}
            />
          </Field>
          <div className="grid grid-cols-2 gap-6">
            <Field label="Nombre" required htmlFor="qc-name">
              <Input id="qc-name" autoFocus placeholder="Ej: Jabón de mano" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Existencias" htmlFor="qc-stock">
              <InputGroup id="qc-stock" type="number" placeholder="0" suffix="Unidad" />
            </Field>
            <Field label="Código de barras" htmlFor="qc-barcode">
              <Input id="qc-barcode" placeholder="Opcional" />
            </Field>
            <Field label="Categoría" htmlFor="qc-cat">
              <Input id="qc-cat" placeholder="Buscar o crear categoría" />
            </Field>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-6 rounded-lg bg-white p-6 shadow-card">
          <Field label="Precio de venta" htmlFor="qc-price" help="Incluyendo impuestos">
            <InputGroup id="qc-price" type="number" prefix="$" placeholder="0.00" suffix="por Unidad" />
          </Field>
          <Field
            label="Costo"
            htmlFor="qc-cost"
            help="Incluyendo impuestos"
            labelAddon={
              <span className="inline-flex items-center gap-1 text-sm font-medium text-sky-500">
                neto <ChevronDown className="size-4" />
              </span>
            }
          >
            <InputGroup id="qc-cost" type="number" prefix="$" placeholder="0.00" suffix="por Unidad" />
          </Field>
        </div>
        <Button variant="soft" className="w-full">
          Ir al Editor Completo
          <ChevronRight />
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/** Modal "Tienes cambios sin guardar" (D-product-unsaved-dialog.png). */
function UnsavedDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Abrir "Cambios sin guardar"</Button>
      </DialogTrigger>
      <DialogContent
        title="Tienes cambios sin guardar"
        size="sm"
        footer={
          <>
            <DialogClose asChild>
              <Button>Continuar Editando</Button>
            </DialogClose>
            <DialogClose asChild>
              <Button variant="primary">Salir sin Guardar</Button>
            </DialogClose>
          </>
        }
      >
        <p className="text-sm text-gray-600">Al salir de esta sección se perderán todos los cambios no guardados</p>
      </DialogContent>
    </Dialog>
  );
}

export function DesignSystemPage() {
  const [seg, setSeg] = React.useState<'amount' | 'percent'>('amount');
  const [tab, setTab] = React.useState<'all' | 'pending' | 'undelivered'>('all');
  return (
    <Page>
      <PageHeader title="Sistema de diseño" description="Componentes reutilizables reconstruidos a partir de reference/pulpos/design-system.md." />

      <Section id="colores" title="Colores">
        <div className="grid grid-cols-5 gap-3">
          {SWATCHES.map(([name, hex, cls]) => (
            <div key={name} className="overflow-hidden rounded-lg bg-white shadow-card">
              <div className={`h-14 ${cls}`} />
              <div className="p-3">
                <p className="text-xs font-medium text-gray-900">{name}</p>
                <p className="text-xs text-gray-500">{hex}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="tipografia" title="Tipografía">
        <Card className="space-y-3 p-6">
          <p className="font-display text-2xl font-extrabold">Saludo / POS — Manrope 24/800</p>
          <p className="font-display text-xl font-bold">Título de página — Manrope 20/700</p>
          <p className="text-3xl font-semibold">KPI $115,398 — Inter 30/600</p>
          <p className="text-lg font-medium">Título de modal — Inter 18/500</p>
          <p className="text-base font-semibold">Título de tarjeta — Inter 16/600</p>
          <p className="text-sm">Cuerpo e interfaz — Inter 14/400</p>
          <p className="text-xs text-gray-500">Secundario y ayuda — Inter 12/400</p>
        </Card>
      </Section>

      <Section id="botones" title="Botones">
        <Card className="flex flex-wrap items-center gap-4 p-6">
          <Button variant="primary">
            <Plus />
            Primario
          </Button>
          <Button variant="primary" disabled>
            Deshabilitado
          </Button>
          <Button>Secundario</Button>
          <Button variant="soft">Gestionar Pedidos</Button>
          <Button variant="link">Ver reporte</Button>
          <Button variant="ghost">
            <Trash2 />
            Eliminar
          </Button>
          <Button size="icon" aria-label="Editar">
            <Pencil />
          </Button>
          <Button size="back" aria-label="Regresar">
            <ChevronRight className="rotate-180" />
          </Button>
          <div className="w-80">
            <Button variant="primary" size="lg" className="w-full">
              Cobrar $12.00 <Shortcut keys={['Ctrl', '↵']} className="ml-2 [&_kbd]:border-white/40 [&_kbd]:bg-transparent [&_kbd]:text-white" />
            </Button>
          </div>
        </Card>
      </Section>

      <Section id="formularios" title="Campos de formulario">
        <Card className="grid grid-cols-3 gap-6 p-6">
          <Field label="Nombre" required htmlFor="f1">
            <Input id="f1" placeholder="Ej: Jabón de mano" />
          </Field>
          <Field label="Precio de venta" htmlFor="f2" help="Incluyendo impuestos">
            <InputGroup id="f2" type="number" prefix="$" placeholder="0.00" suffix="por Unidad" />
          </Field>
          <Field label="Con error" htmlFor="f3" error="El nombre es obligatorio">
            <Input id="f3" aria-invalid="true" />
          </Field>
          <Field label="Motivo del Ajuste">
            <Select
              aria-label="Motivo del Ajuste"
              className="w-full"
              placeholder="Elegir Motivo"
              options={['Corrección', 'Conteo', 'Expiración', 'Robo o pérdida', 'Deterioro', 'Regalo'].map((m) => ({ value: m, label: m }))}
            />
          </Field>
          <div className="space-y-3 pt-6">
            <CheckboxField id="c1" label="Vender en el Punto de Venta" defaultChecked />
            <CheckboxField id="c2" label="Utilizar Lotes y Caducidades" />
          </div>
          <div className="space-y-3">
            <Segmented
              value={seg}
              onChange={setSeg}
              fullWidth
              options={[
                { value: 'amount', label: 'Cantidad ($)' },
                { value: 'percent', label: 'Porcentaje (%)' },
              ]}
            />
            <PillTabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'all', label: 'Todas' },
                { value: 'pending', label: 'Pagos Pendientes', count: 130 },
                { value: 'undelivered', label: 'No Entregadas', count: 166 },
              ]}
            />
          </div>
        </Card>
      </Section>

      <Section id="insignias" title="Insignias de estado">
        <Card className="flex flex-wrap gap-3 p-6">
          <Badge tone="success">Pagada</Badge>
          <Badge tone="success">Entregados</Badge>
          <Badge tone="danger">0 unidades</Badge>
          <Badge tone="debt">Deuda pendiente</Badge>
          <Badge tone="warning">No Entregados</Badge>
          <Badge tone="success">↑ Entrada</Badge>
          <Badge tone="danger">↓ Salida</Badge>
          <Badge tone="success">Ingreso</Badge>
          <Badge tone="danger">Retiro</Badge>
        </Card>
      </Section>

      <Section id="modales" title="Modales y menús">
        <Card className="flex flex-wrap gap-4 p-6">
          <QuickCreateDialog />
          <UnsavedDialog />
          <AddProductMenu />
        </Card>
      </Section>

      <Section id="patron-lista" title="Patrón: página de lista (referencia D-products-list.png)">
        <ListPattern />
      </Section>

      <Section id="vacio" title="Estado vacío">
        <Card>
          <EmptyState
            title="Ajusta el stock de tu negocio"
            description="Registra entradas y salidas de stock o realiza conteos físicos para mantener tu inventario siempre al día."
            actions={
              <>
                <Button>Nuevo Conteo de Stock</Button>
                <Button variant="primary">
                  Nueva Entrada o Salida <ChevronDown />
                </Button>
              </>
            }
          />
        </Card>
      </Section>

      <Section id="tarjeta" title="Tarjeta de formulario + barra inferior fija">
        <Card>
          <CardContent>
            <CardTitle>Datos del Producto</CardTitle>
            <div className="mt-4 grid grid-cols-2 gap-6">
              <Field label="Código de barras" htmlFor="t1">
                <Input id="t1" placeholder="Opcional" />
              </Field>
              <Field label="SKU" htmlFor="t2">
                <Input id="t2" placeholder="Opcional" />
              </Field>
            </div>
          </CardContent>
        </Card>
        <StickyFooter>
          <Button>Cancelar</Button>
          <Button disabled>Guardar Borrador</Button>
          <Button variant="primary">Confirmar Entrada</Button>
        </StickyFooter>
      </Section>
    </Page>
  );
}
