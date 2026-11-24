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
import { Select } from '@/components/ui/select';
import { useConnection } from '@/db/connection';
import { getPrintSettings, printOnServer, savePrintSettings, type PrintSettings } from '@/print/output';
import { getLocalPrint, MAX_COPIES, mostradorLauncher, saveLocalPrint, type LocalPrint } from '@/print/local';
import { downloadBlob } from '@/lib/download';
import { ticketText, type TicketLine } from '@/print/escpos';

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
      <ThisPcPrintCard />
      <ServerPrinterCard />
    </>
  );
}

/**
 * Impresión de esta PC (D39): imprimir al cobrar y cuántas copias. Se guarda en este navegador. Para que no pregunte
 * la impresora, se descarga el acceso de mostrador (abre el POS con impresión directa en la impresora predeterminada).
 */
function ThisPcPrintCard() {
  const [p, setP] = React.useState<LocalPrint>(getLocalPrint);
  const [printer, setPrinter] = React.useState('WL88S');
  const save = (patch: Partial<LocalPrint>) => {
    const next = { ...p, ...patch };
    saveLocalPrint(next);
    setP(next);
  };
  return (
    <SettingsCard title="Impresión en esta PC">
      <CheckboxField
        id="print-auto"
        label="Imprimir el ticket al cobrar"
        description="En esta PC, al cobrar una venta el ticket sale solo, sin apretar «Imprimir Ticket»."
        checked={p.autoPrint}
        onCheckedChange={(v) => save({ autoPrint: v === true })}
      />
      <Field label="Copias del ticket al cobrar" htmlFor="print-copies" help="Cada copia sale aparte, con su propio corte. Las reimpresiones desde Ventas salen una sola vez.">
        <Select
          id="print-copies"
          aria-label="Copias del ticket al cobrar"
          className="min-w-72"
          value={String(p.copies)}
          options={Array.from({ length: MAX_COPIES }, (_, i) => ({ value: String(i + 1), label: i === 0 ? '1 copia' : `${i + 1} copias` }))}
          onValueChange={(v) => save({ copies: Number(v) })}
        />
      </Field>
      <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
        <p className="font-medium text-gray-900">Imprimir sin que pregunte la impresora</p>
        <p className="mt-1">
          En la PC donde está la impresora de tickets, descarga este acceso y ábrelo: deja esa impresora como predeterminada y abre el
          Punto de Venta en su propia ventana, donde los tickets salen directo. Ahí vuelve a marcar «Imprimir el ticket al cobrar» y las copias.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Impresora de tickets de esa PC" htmlFor="print-mostrador">
            <Input id="print-mostrador" className="w-56" value={printer} onChange={(e) => setPrinter(e.target.value)} />
          </Field>
          <Button
            type="button"
            onClick={() => downloadBlob('Punto de Venta (mostrador).cmd', new Blob([mostradorLauncher(new URL('./', location.href).href, printer)], { type: 'application/octet-stream' }))}
          >
            Descargar acceso de mostrador
          </Button>
        </div>
      </div>
    </SettingsCard>
  );
}

const COLUMN_OPTIONS = [
  { value: '48', label: '80 mm (48 caracteres)' },
  { value: '42', label: '80 mm, letra grande (42 caracteres)' },
  { value: '32', label: '58 mm (32 caracteres)' },
];

function testTicket(t: TicketSettings, columns: number): TicketLine[] {
  return [
    { type: 'text', text: t.businessName, align: 'center', bold: true, big: true },
    { type: 'text', text: 'Prueba de impresión', align: 'center' },
    { type: 'rule' },
    { type: 'row', left: 'Impresora', right: 'OK', bold: true },
    { type: 'row', left: 'Ancho', right: `${columns} caracteres` },
    { type: 'text', text: 'Acentos y eñes: áéíóú ÁÉÍÓÚ ñ Ñ ¿? ¡!' },
    { type: 'text', text: '1234567890'.repeat(7).slice(0, columns) },
    { type: 'rule' },
    { type: 'row', left: 'TOTAL', right: '$1,234.50', bold: true, big: true },
    { type: 'rule' },
    { type: 'text', text: t.footer || 'Fin de la prueba', align: 'center' },
  ];
}

/**
 * Impresora de tickets de la PC servidor (diseño propio, D35): todas las PCs mandan sus tickets a esa impresora.
 * Solo aparece cuando el POS trabaja con el Servidor POS.
 */
function ServerPrinterCard() {
  const db = useDb();
  const toast = useToast();
  const conn = useConnection();
  const saved = useLiveQuery(getPrintSettings, []);
  const ticket = useLiveQuery(getTicketSettings, []);
  const [printers, setPrinters] = React.useState<{ name: string; isDefault: boolean }[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [testing, setTesting] = React.useState(false);
  const server = conn.mode === 'server';

  const loadPrinters = React.useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('./api/printers', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setPrinters(data);
    } catch (e) {
      setLoadError(`No se pudo leer la lista de impresoras de la PC servidor: ${e instanceof Error ? e.message : e}`);
    }
  }, []);
  React.useEffect(() => {
    if (server) void loadPrinters();
  }, [server, loadPrinters]);

  if (!server || !saved || !ticket) return null;
  const save = (patch: Partial<PrintSettings>) => db.write((tx) => savePrintSettings(tx, { ...saved, ...patch })).catch((e) => toast.error(e));
  const options = (printers ?? []).map((p) => ({ value: p.name, label: p.isDefault ? `${p.name} (predeterminada)` : p.name }));
  if (saved.printer && !options.some((o) => o.value === saved.printer)) options.unshift({ value: saved.printer, label: `${saved.printer} (no encontrada)` });
  const sample = testTicket(ticket, saved.columns);

  return (
    <SettingsCard title="Impresora de tickets de la PC servidor">
      <CheckboxField
        id="print-server"
        label="Imprimir los tickets en la impresora de la PC servidor"
        description="Las notas, cortes y cobros de todas las PCs salen en esta impresora. Si lo desactivas, cada PC abre su propio diálogo de impresión."
        checked={saved.enabled}
        onCheckedChange={(v) => save({ enabled: v === true })}
      />
      <Field label="Impresora" htmlFor="print-printer" help="Las impresoras instaladas en Windows de la PC servidor.">
        <div className="flex flex-wrap items-center gap-2">
          <Select id="print-printer" aria-label="Impresora" className="min-w-72" value={saved.printer || undefined} placeholder={printers ? 'Elige la impresora' : 'Buscando impresoras…'} options={options} onValueChange={(v) => save({ printer: v })} />
          <Button type="button" onClick={() => void loadPrinters()}>
            Actualizar lista
          </Button>
        </div>
      </Field>
      {loadError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {loadError}
        </p>
      )}
      <Field label="Ancho del papel" htmlFor="print-columns">
        <Select id="print-columns" aria-label="Ancho del papel" className="min-w-72" value={String(saved.columns)} options={COLUMN_OPTIONS} onValueChange={(v) => save({ columns: Number(v) })} />
      </Field>
      <CheckboxField id="print-cut" label="Cortar el papel al terminar cada ticket" checked={saved.cut} onCheckedChange={(v) => save({ cut: v === true })} />
      <div className="flex flex-wrap items-start gap-6">
        <Button
          type="button"
          variant="primary"
          disabled={!saved.printer || testing}
          onClick={async () => {
            setTesting(true);
            try {
              await printOnServer(saved, sample);
              toast.success('Prueba enviada a la impresora');
            } catch (e) {
              toast.error(e);
            } finally {
              setTesting(false);
            }
          }}
        >
          {testing ? 'Imprimiendo…' : 'Imprimir prueba'}
        </Button>
        <pre aria-label="Vista previa del ticket de prueba" className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] leading-snug text-gray-800">
          {ticketText(sample, saved.columns)}
        </pre>
      </div>
    </SettingsCard>
  );
}
