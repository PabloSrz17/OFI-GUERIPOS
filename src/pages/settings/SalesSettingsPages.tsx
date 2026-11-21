import * as React from 'react';
import { PageHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckboxField } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input, InputGroup, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/feedback';
import { useDb, useLiveQuery } from '@/db/hooks';
import { DEFAULT_CREDIT_LIMIT_KEY } from '@/repos/clients';
import { BLOCK_OVERDUE_KEY, CREDIT_DAYS_KEY, DEFAULT_CREDIT_DAYS } from '@/repos/sales';
import { getSetting, setSetting } from '@/repos/settings';
import { getTicketSettings, saveTicketSettings, type TicketSettings } from '@/sales/ticket';

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="mb-6 overflow-hidden">
      <h2 className="border-b border-gray-200 px-6 py-4 text-sm font-semibold text-gray-900">{title}</h2>
      <div className="space-y-4 px-6 py-6">{children}</div>
    </Card>
  );
}

const toPesos = (cents: number | null) => (cents === null ? '' : String(cents / 100));

/**
 * Preferencias → Clientes (J-settings-clients.png). Los cambios se guardan al momento, como en Pulpos.
 * "Portal de Clientes" se omite (no está en el alcance). "Plazo de Crédito" es diseño propio (D15).
 */
export function ClientsSettingsPage() {
  const db = useDb();
  const toast = useToast();
  const s = useLiveQuery(
    (tx) => ({
      limit: getSetting<number | null>(tx, DEFAULT_CREDIT_LIMIT_KEY, null),
      block: getSetting<boolean>(tx, BLOCK_OVERDUE_KEY, false),
      days: getSetting<number>(tx, CREDIT_DAYS_KEY, DEFAULT_CREDIT_DAYS),
    }),
    [],
  );
  const [mode, setMode] = React.useState<'none' | 'fixed'>('none');
  const [amount, setAmount] = React.useState('');
  const [days, setDays] = React.useState('');
  const loaded = React.useRef(false);
  React.useEffect(() => {
    if (!s || loaded.current) return;
    loaded.current = true;
    setMode(s.limit === null ? 'none' : 'fixed');
    setAmount(toPesos(s.limit));
    setDays(String(s.days));
  }, [s]);

  if (!s) return null;
  const save = async (key: string, value: unknown) => {
    try {
      await db.write((tx) => setSetting(tx, key, value));
      toast.success('Preferencia guardada');
    } catch (e) {
      toast.error(e);
    }
  };
  const saveAmount = () => {
    const v = Math.round(Number(amount) * 100);
    if (!Number.isFinite(v) || v < 0 || amount.trim() === '') return;
    if (v !== s.limit) save(DEFAULT_CREDIT_LIMIT_KEY, v);
  };
  const saveDays = () => {
    const v = Math.round(Number(days));
    if (!Number.isFinite(v) || v < 1 || v > 365) {
      setDays(String(s.days));
      return;
    }
    if (v !== s.days) save(CREDIT_DAYS_KEY, v);
  };

  return (
    <>
      <PageHeader title="Clientes" />
      <SettingsCard title="Crédito Predeterminado para Clientes">
        <div role="radiogroup" aria-label="Crédito predeterminado" className="space-y-4">
          <label className="flex items-center gap-3 text-sm text-gray-900">
            <input
              type="radio"
              name="default-credit"
              className="size-4 accent-sky-600"
              checked={mode === 'none'}
              onChange={() => {
                setMode('none');
                save(DEFAULT_CREDIT_LIMIT_KEY, null);
              }}
            />
            Sin limitar
          </label>
          <label className="flex items-center gap-3 text-sm text-gray-900">
            <input type="radio" name="default-credit" className="size-4 accent-sky-600" checked={mode === 'fixed'} onChange={() => setMode('fixed')} />
            Limitar por monto fijo
          </label>
        </div>
        {mode === 'fixed' && (
          <Field label="Monto predeterminado" htmlFor="set-credit-amount" help="Aplica a los clientes sin un límite personalizado." className="max-w-xs pl-7">
            <InputGroup
              id="set-credit-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              prefix="$"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onBlur={saveAmount}
              onKeyDown={(e) => e.key === 'Enter' && saveAmount()}
              autoFocus={s.limit === null}
            />
          </Field>
        )}
      </SettingsCard>
      <SettingsCard title="Deuda Pendiente">
        <CheckboxField
          id="set-block-overdue"
          label="Restringir vender a crédito a clientes con deuda vencida"
          checked={s.block}
          onCheckedChange={(v) => save(BLOCK_OVERDUE_KEY, v === true)}
        />
      </SettingsCard>
      <SettingsCard title="Plazo de Crédito">
        <Field label="Días para pagar una venta a crédito" htmlFor="set-credit-days" help="Define la fecha de vencimiento de cada venta a crédito." className="max-w-xs">
          <Input
            id="set-credit-days"
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            onBlur={saveDays}
            onKeyDown={(e) => e.key === 'Enter' && saveDays()}
          />
        </Field>
      </SettingsCard>
    </>
  );
}

const TICKET_FIELDS: { key: keyof TicketSettings; label: string; multiline?: boolean }[] = [
  { key: 'businessName', label: 'Nombre del negocio' },
  { key: 'address', label: 'Dirección', multiline: true },
  { key: 'phone', label: 'Teléfono' },
  { key: 'rfc', label: 'RFC' },
  { key: 'footer', label: 'Mensaje al pie del ticket', multiline: true },
];

/** Preferencias → Tickets. Diseño propio: Pulpos no se inspeccionó aquí (no se tocó su configuración). */
export function TicketSettingsPage() {
  const db = useDb();
  const toast = useToast();
  const saved = useLiveQuery(getTicketSettings, []);
  const [form, setForm] = React.useState<TicketSettings | null>(null);
  React.useEffect(() => {
    if (saved && !form) setForm(saved);
  }, [saved, form]);
  if (!form || !saved) return null;
  const dirty = TICKET_FIELDS.some(({ key }) => form[key] !== saved[key]);

  return (
    <>
      <PageHeader title="Tickets" />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!form.businessName.trim()) return toast.error('El nombre del negocio es obligatorio');
          try {
            const clean = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])) as unknown as TicketSettings;
            await db.write((tx) => saveTicketSettings(tx, clean));
            setForm(clean);
            toast.success('Ticket guardado');
          } catch (err) {
            toast.error(err);
          }
        }}
      >
        <SettingsCard title="Encabezado y pie del ticket (80 mm)">
          {TICKET_FIELDS.map(({ key, label, multiline }) => (
            <Field key={key} label={label} htmlFor={`ticket-${key}`} required={key === 'businessName'}>
              {multiline ? (
                <Textarea
                  id={`ticket-${key}`}
                  rows={2}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              ) : (
                <Input id={`ticket-${key}`} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              )}
            </Field>
          ))}
        </SettingsCard>
        <div className="flex justify-end gap-3">
          <Button type="button" disabled={!dirty} onClick={() => setForm(saved)}>
            Descartar
          </Button>
          <Button type="submit" variant="primary" disabled={!dirty}>
            Guardar
          </Button>
        </div>
      </form>
    </>
  );
}
