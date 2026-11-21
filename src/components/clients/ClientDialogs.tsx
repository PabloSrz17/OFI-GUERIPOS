import * as React from 'react';
import { CircleHelp, MapPin, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, InputGroup, Textarea, inputClasses } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/feedback';
import { useDb, useLiveQuery } from '@/db/hooks';
import { listPriceLists } from '@/repos/categories';
import { createClient, DEFAULT_CREDIT_LIMIT_KEY, formatAddress, getSetting, patchClient, updateClient, type ClientAddress, type ClientDetail } from '@/repos/clients';
import { ValidationError } from '@/repos/common';
import { centsToInput, parseMoneyToCents } from '@/domain/catalog';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

export const MX_STATES = [
  'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche', 'Chiapas', 'Chihuahua', 'Ciudad de México', 'Coahuila', 'Colima', 'Durango',
  'Estado de México', 'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco', 'Michoacán', 'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro',
  'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora', 'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas',
];

const COUNTRY_CODES = [
  { value: '+52', label: '+52' },
  { value: '+1', label: '+1' },
];

// Banderas dibujadas: Windows no muestra los emoji de bandera.
function Flag({ code }: { code: string }) {
  if (code === '+1')
    return (
      <svg viewBox="0 0 18 12" style={{ width: 18, height: 12 }} className="rounded-[2px]" aria-hidden="true">
        <rect width="18" height="12" fill="#fff" />
        {[0, 2, 4, 6, 8, 10].map((y) => <rect key={y} y={y} width="18" height="1" fill="#b22234" />)}
        <rect width="8" height="6" fill="#3c3b6e" />
      </svg>
    );
  return (
    <svg viewBox="0 0 18 12" style={{ width: 18, height: 12 }} className="rounded-[2px]" aria-hidden="true">
      <rect width="6" height="12" fill="#006847" />
      <rect x="6" width="6" height="12" fill="#fff" />
      <rect x="12" width="6" height="12" fill="#ce1126" />
      <circle cx="9" cy="6" r="1.4" fill="#8c6a2f" />
    </svg>
  );
}

function FormCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white p-6 shadow-card">
      <h5 className="mb-5 text-sm font-semibold text-gray-900">{title}</h5>
      {children}
    </div>
  );
}

// ---------- Ingresar Dirección ----------

function AddressDialog({ open, onOpenChange, value, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; value: ClientAddress; onSave: (a: ClientAddress) => void }) {
  const [a, setA] = React.useState<ClientAddress>(value);
  React.useEffect(() => {
    if (open) setA(value);
  }, [open, value]);
  const set = (k: keyof ClientAddress) => (e: React.ChangeEvent<HTMLInputElement>) => setA((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Ingresar Dirección"
        className="max-w-[608px]"
        footer={
          <>
            <DialogClose asChild>
              <Button>Cancelar</Button>
            </DialogClose>
            <Button
              variant="primary"
              onClick={() => {
                onSave(a);
                onOpenChange(false);
              }}
            >
              Guardar
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          <Field label="Calle" htmlFor="ad-street" className="col-span-2">
            <Input id="ad-street" placeholder="Ingresa una calle" value={a.street ?? ''} onChange={set('street')} />
          </Field>
          <Field label="Número Exterior" htmlFor="ad-ext">
            <Input id="ad-ext" placeholder="Opcional" value={a.ext ?? ''} onChange={set('ext')} />
          </Field>
          <Field label="Número Interior" htmlFor="ad-int">
            <Input id="ad-int" placeholder="Opcional" value={a.int ?? ''} onChange={set('int')} />
          </Field>
          <Field label="Código postal" htmlFor="ad-zip">
            <Input id="ad-zip" inputMode="numeric" placeholder="Ingresar código postal" value={a.zip ?? ''} onChange={set('zip')} />
          </Field>
          <Field label="Colonia" htmlFor="ad-col">
            <Input id="ad-col" placeholder="Opcional" value={a.neighborhood ?? ''} onChange={set('neighborhood')} />
          </Field>
          <Field label="Municipio" htmlFor="ad-mun" className="col-span-2">
            <Input id="ad-mun" placeholder="Opcional" value={a.municipality ?? ''} onChange={set('municipality')} />
          </Field>
          <Field label="Ciudad" htmlFor="ad-city">
            <Input id="ad-city" placeholder="Opcional" value={a.city ?? ''} onChange={set('city')} />
          </Field>
          <Field label="Estado" htmlFor="ad-state">
            <Select id="ad-state" aria-label="Estado" className="w-full" placeholder="Seleccionar" value={a.state ?? undefined} onValueChange={(v) => setA((x) => ({ ...x, state: v }))} options={MX_STATES.map((s) => ({ value: s, label: s }))} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Nuevo / Editar Cliente ----------

interface ClientForm {
  firstName: string;
  lastName: string;
  phoneCountry: string;
  phone: string;
  email: string;
  assignList: boolean;
  priceListId: string | null;
  comments: string;
  address: ClientAddress;
}

function formFrom(c?: ClientDetail | null, initialName = ''): ClientForm {
  return {
    firstName: c?.first_name ?? initialName,
    lastName: c?.last_name ?? '',
    phoneCountry: c?.phone_country ?? '+52',
    phone: c?.phone ?? '',
    email: c?.email ?? '',
    assignList: !!c?.price_list_id,
    priceListId: c?.price_list_id ?? null,
    comments: c?.comments ?? '',
    address: c
      ? { street: c.address_street, ext: c.address_ext, int: c.address_int, zip: c.address_zip, neighborhood: c.address_neighborhood, municipality: c.address_municipality, city: c.address_city, state: c.address_state }
      : {},
  };
}

interface ClientDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  client?: ClientDetail | null;
  initialName?: string;
  onSaved?: (id: string) => void;
}

/** "Nuevo Cliente" / "Editar Cliente" (J-client-new-form.png). Sin la pestaña Datos de Facturación (fuera del alcance). */
export function ClientDialog({ open, onOpenChange, client, initialName, onSaved }: ClientDialogProps) {
  const db = useDb();
  const toast = useToast();
  const lists = useLiveQuery(listPriceLists, []) ?? [];
  const [f, setF] = React.useState<ClientForm>(() => formFrom(client, initialName));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [addressOpen, setAddressOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const nameRef = React.useRef<HTMLInputElement>(null);
  const editing = !!client;

  React.useEffect(() => {
    if (open) {
      setF(formFrom(client, initialName));
      setErrors({});
    }
  }, [open, client, initialName]);

  const set = <K extends keyof ClientForm>(k: K, v: ClientForm[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };
  const address = formatAddress({
    address_street: f.address.street ?? null,
    address_ext: f.address.ext ?? null,
    address_int: f.address.int ?? null,
    address_zip: f.address.zip ?? null,
    address_neighborhood: f.address.neighborhood ?? null,
    address_municipality: f.address.municipality ?? null,
    address_city: f.address.city ?? null,
    address_state: f.address.state ?? null,
  });

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!f.firstName.trim() || busy) return;
    setBusy(true);
    try {
      const input = {
        firstName: f.firstName,
        lastName: f.lastName,
        phoneCountry: f.phoneCountry,
        phone: f.phone,
        email: f.email,
        priceListId: f.assignList ? f.priceListId : null,
        comments: f.comments,
        address: f.address,
      };
      const id = await db.write((tx) => {
        if (editing) {
          updateClient(tx, client!.id, input);
          return client!.id;
        }
        return createClient(tx, input);
      });
      toast.success(editing ? 'Cliente actualizado' : 'Cliente creado');
      onOpenChange(false);
      onSaved?.(id);
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
        title={editing ? 'Editar Cliente' : 'Nuevo Cliente'}
        size="md"
        bodyTone="gray"
        bodyClassName="space-y-4"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          nameRef.current?.focus();
        }}
        footer={
          <>
            <DialogClose asChild>
              <Button>Cancelar</Button>
            </DialogClose>
            <Button variant="primary" disabled={!f.firstName.trim() || busy} onClick={() => save()}>
              {editing ? 'Guardar Cambios' : 'Crear Cliente'}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormCard title="Información del Cliente">
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              <Field label="Nombre" required htmlFor="cl-first" error={errors.firstName}>
                <Input ref={nameRef} id="cl-first" placeholder="Ingresar nombre" value={f.firstName} aria-invalid={!!errors.firstName} onChange={(e) => set('firstName', e.target.value)} />
              </Field>
              <Field label="Apellido" htmlFor="cl-last">
                <Input id="cl-last" placeholder="Ingresar apellido" value={f.lastName} onChange={(e) => set('lastName', e.target.value)} />
              </Field>
              <Field label="Teléfono" htmlFor="cl-phone" className="col-span-2" error={errors.phone}>
                <div className="flex">
                  <Select aria-label="Código de país" className="w-[108px] shrink-0 rounded-r-none" icon={<Flag code={f.phoneCountry} />} value={f.phoneCountry} onValueChange={(v) => set('phoneCountry', v)} options={COUNTRY_CODES} />
                  <input id="cl-phone" type="tel" inputMode="tel" className={cn(inputClasses, '-ml-px rounded-l-none')} placeholder="Ingresar teléfono" value={f.phone} aria-invalid={!!errors.phone} onChange={(e) => set('phone', e.target.value)} />
                </div>
              </Field>
              <Field label="Email" htmlFor="cl-email" className="col-span-2" error={errors.email}>
                <Input id="cl-email" type="email" placeholder="Ingresar email" value={f.email} aria-invalid={!!errors.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
            </div>
          </FormCard>

          <FormCard title="Precios">
            <div className="flex items-center gap-3">
              <Checkbox id="cl-assign" checked={f.assignList} onCheckedChange={(v) => set('assignList', v === true)} />
              <label htmlFor="cl-assign" className="text-sm text-gray-900">
                Asignar una lista de precios al cliente
              </label>
              <span title="En el punto de venta se usarán los precios de esta lista para el cliente" className="text-gray-400">
                <CircleHelp className="size-4" />
              </span>
            </div>
            {f.assignList && (
              <Select
                aria-label="Lista de precios del cliente"
                className="mt-4 w-full"
                placeholder="Seleccionar lista"
                value={f.priceListId ?? undefined}
                onValueChange={(v) => set('priceListId', v)}
                options={lists.map((l) => ({ value: l.id, label: l.name }))}
              />
            )}
          </FormCard>

          <FormCard title="Dirección y Más">
            <div className="space-y-5">
              <Field label="Dirección">
                {address ? (
                  <div className="flex items-start justify-between gap-3 rounded-md border border-gray-200 p-3 text-sm text-gray-700">
                    <span className="flex gap-2">
                      <MapPin className="mt-0.5 size-4 shrink-0 text-gray-400" />
                      {address}
                    </span>
                    <button type="button" aria-label="Editar dirección" onClick={() => setAddressOpen(true)} className="rounded p-1 text-gray-500 hover:bg-gray-100">
                      <Pencil className="size-4" />
                    </button>
                  </div>
                ) : (
                  <div>
                    <Button onClick={() => setAddressOpen(true)}>
                      <Plus />
                      Añadir Dirección
                    </Button>
                  </div>
                )}
              </Field>
              <Field label="Comentarios" htmlFor="cl-comments">
                <Textarea id="cl-comments" rows={3} placeholder="Agrega información adicional de tu cliente" value={f.comments} onChange={(e) => set('comments', e.target.value)} />
              </Field>
            </div>
          </FormCard>
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>
        <AddressDialog open={addressOpen} onOpenChange={setAddressOpen} value={f.address} onSave={(a) => set('address', a)} />
      </DialogContent>
    </Dialog>
  );
}

// ---------- Ediciones puntuales del detalle ----------

export function PriceListDialog({ open, onOpenChange, client }: { open: boolean; onOpenChange: (o: boolean) => void; client: ClientDetail }) {
  const db = useDb();
  const lists = useLiveQuery(listPriceLists, []) ?? [];
  const [value, setValue] = React.useState<string>('none');
  React.useEffect(() => {
    if (open) setValue(client.price_list_id ?? 'none');
  }, [open, client.price_list_id]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Editar Lista de Precios"
        size="sm"
        footer={
          <>
            <DialogClose asChild>
              <Button>Cancelar</Button>
            </DialogClose>
            <Button
              variant="primary"
              onClick={async () => {
                await db.write((tx) => patchClient(tx, client.id, { priceListId: value === 'none' ? null : value }));
                onOpenChange(false);
              }}
            >
              Guardar
            </Button>
          </>
        }
      >
        <Field label="Lista de precios">
          <Select aria-label="Lista de precios" className="w-full" value={value} onValueChange={setValue} options={[{ value: 'none', label: 'Sin lista asignada' }, ...lists.map((l) => ({ value: l.id, label: l.name }))]} />
        </Field>
      </DialogContent>
    </Dialog>
  );
}

/** "Editar Límite de Crédito" (J-client-credit-limit.png). En Pulpos el límite personalizado es de Plan Pro; aquí está disponible. */
export function CreditLimitDialog({ open, onOpenChange, client }: { open: boolean; onOpenChange: (o: boolean) => void; client: ClientDetail }) {
  const db = useDb();
  const defaultLimit = useLiveQuery((tx) => getSetting<number | null>(tx, DEFAULT_CREDIT_LIMIT_KEY, null), []);
  const [mode, setMode] = React.useState<'default' | 'custom'>('default');
  const [amount, setAmount] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setMode(client.credit_limit_cents === null ? 'default' : 'custom');
      setAmount(client.credit_limit_cents === null ? '' : centsToInput(client.credit_limit_cents) || '0');
      setError(null);
    }
  }, [open, client.credit_limit_cents]);
  const defaultLabel = defaultLimit === null || defaultLimit === undefined ? 'Sin limitar' : formatMoney(defaultLimit / 100);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Editar Límite de Crédito"
        size="md"
        className="max-w-[432px]"
        bodyClassName="p-0"
        footer={
          <>
            <DialogClose asChild>
              <Button>Cancelar</Button>
            </DialogClose>
            <Button
              variant="primary"
              disabled={mode === 'custom' && amount.trim() === ''}
              onClick={async () => {
                try {
                  await db.write((tx) => patchClient(tx, client.id, { creditLimitCents: mode === 'default' ? null : parseMoneyToCents(amount) }));
                  onOpenChange(false);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Guardar
            </Button>
          </>
        }
      >
        <div className="bg-gray-100 px-6 py-6">
          <div className="flex items-center justify-between rounded-lg bg-white px-4 py-3 text-sm text-gray-900 shadow-card">
            <span>Límite Predeterminado:</span>
            <span>{defaultLabel}</span>
          </div>
        </div>
        <div role="radiogroup" aria-label="Límite de crédito" className="space-y-4 px-6 py-6">
          <label className="flex items-center gap-3 text-sm text-gray-900">
            <input type="radio" name="limit" className="size-4 accent-sky-600" checked={mode === 'default'} onChange={() => setMode('default')} />
            Límite predeterminado <span className="text-gray-400">{defaultLabel}</span>
          </label>
          <label className="flex items-center gap-3 text-sm text-gray-900">
            <input type="radio" name="limit" className="size-4 accent-sky-600" checked={mode === 'custom'} onChange={() => setMode('custom')} />
            Personalizar límite para este cliente
          </label>
          {mode === 'custom' && (
            <Field label="Monto del límite" htmlFor="cl-limit" error={error} className="pl-7">
              <InputGroup id="cl-limit" type="number" inputMode="decimal" min={0} step="0.01" prefix="$" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </Field>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CommentsDialog({ open, onOpenChange, client }: { open: boolean; onOpenChange: (o: boolean) => void; client: ClientDetail }) {
  const db = useDb();
  const [text, setText] = React.useState('');
  React.useEffect(() => {
    if (open) setText(client.comments ?? '');
  }, [open, client.comments]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Comentarios"
        size="md"
        footer={
          <>
            <DialogClose asChild>
              <Button>Cancelar</Button>
            </DialogClose>
            <Button
              variant="primary"
              onClick={async () => {
                await db.write((tx) => patchClient(tx, client.id, { comments: text }));
                onOpenChange(false);
              }}
            >
              Guardar
            </Button>
          </>
        }
      >
        <Textarea aria-label="Comentarios" rows={4} autoFocus placeholder="Agrega información adicional de tu cliente" value={text} onChange={(e) => setText(e.target.value)} />
      </DialogContent>
    </Dialog>
  );
}

