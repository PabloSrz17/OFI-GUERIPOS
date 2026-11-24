import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { CalendarDays, ChevronDown, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { useToast } from '@/components/ui/feedback';
import { useDb } from '@/db/hooks';
import { downloadBlob } from '@/lib/download';
import { XLSX_MIME } from '@/lib/xlsx';
import { fromDateInput, toDateInput } from '@/reports/period';
import { salesReportXlsx } from '@/repos/sales';

export interface ReportDays {
  /** AAAA-MM-DD, hora local. */
  from: string;
  /** AAAA-MM-DD (incluido). Igual a `from` cuando es un solo día. */
  to: string;
}

const shift = (day: string, n: number) => {
  const d = fromDateInput(day)!;
  return toDateInput(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};
const dmy = (day: string) => day.split('-').reverse().join('/');

/** "Hoy", "Ayer", "23/11/2026" o "01/11/2026 – 23/11/2026". */
export function reportDaysLabel(r: ReportDays, today = toDateInput(new Date())) {
  if (r.from === r.to) return r.from === today ? 'Hoy' : r.from === shift(today, -1) ? 'Ayer' : dmy(r.from);
  return `${dmy(r.from)} – ${dmy(r.to)}`;
}

/** reporte-ventas-2026-11-23.xlsx o reporte-ventas-2026-11-01_al_2026-11-23.xlsx */
export function reportFilename(r: ReportDays) {
  return `reporte-ventas-${r.from === r.to ? r.from : `${r.from}_al_${r.to}`}.xlsx`;
}

/** Límites [desde, hasta) en ISO para comparar con created_at. */
export function reportBounds(r: ReportDays) {
  return { from: fromDateInput(r.from)!.toISOString(), to: fromDateInput(shift(r.to, 1))!.toISOString() };
}

/**
 * Ventas → "Descargar Ventas" (diseño propio): selector de día o rango con calendario y descarga en Excel (.xlsx)
 * con folio, cliente, estado, total y deuda activa.
 */
export function SalesReportDownload() {
  const db = useDb();
  const toast = useToast();
  const today = toDateInput(new Date());
  const [days, setDays] = React.useState<ReportDays>({ from: today, to: today });
  const [mode, setMode] = React.useState<'day' | 'range'>('day');
  const [open, setOpen] = React.useState(false);

  const pick = (r: ReportDays) => {
    setDays(r);
    setMode(r.from === r.to ? 'day' : 'range');
  };

  return (
    <div className="flex items-center gap-2">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button aria-label={`Fecha del reporte: ${reportDaysLabel(days, today)}`}>
            <CalendarDays />
            {reportDaysLabel(days, today)}
            <ChevronDown className="text-gray-400" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={6} aria-label="Fecha del reporte" className="z-50 w-80 space-y-4 rounded-lg bg-white p-4 shadow-lg ring-1 ring-black/5">
            <div className="flex gap-2">
              <Button size="sm" onClick={() => (pick({ from: today, to: today }), setOpen(false))}>
                Hoy
              </Button>
              <Button size="sm" onClick={() => (pick({ from: shift(today, -1), to: shift(today, -1) }), setOpen(false))}>
                Ayer
              </Button>
              <Button size="sm" onClick={() => (pick({ from: `${today.slice(0, 8)}01`, to: today }), setOpen(false))}>
                Este mes
              </Button>
            </div>
            <Segmented
              aria-label="Tipo de fecha"
              fullWidth
              value={mode}
              onChange={(m) => {
                setMode(m);
                if (m === 'day') setDays({ from: days.to, to: days.to });
              }}
              options={[
                { value: 'day', label: 'Un día' },
                { value: 'range', label: 'Rango' },
              ]}
            />
            {mode === 'day' ? (
              <label className="block text-sm text-gray-700">
                Día
                <Input type="date" aria-label="Día" className="mt-1" max={today} value={days.from} onChange={(e) => e.target.value && setDays({ from: e.target.value, to: e.target.value })} />
              </label>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm text-gray-700">
                  Desde
                  <Input type="date" aria-label="Desde" className="mt-1" max={days.to} value={days.from} onChange={(e) => e.target.value && setDays({ ...days, from: e.target.value })} />
                </label>
                <label className="block text-sm text-gray-700">
                  Hasta
                  <Input type="date" aria-label="Hasta" className="mt-1" min={days.from} max={today} value={days.to} onChange={(e) => e.target.value && setDays({ ...days, to: e.target.value })} />
                </label>
              </div>
            )}
            <div className="flex justify-end">
              <Button size="sm" variant="primary" onClick={() => setOpen(false)}>
                Listo
              </Button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Button
        onClick={async () => {
          try {
            const bytes = await db.read((tx) => salesReportXlsx(tx, reportBounds(days)));
            downloadBlob(reportFilename(days), new Blob([bytes], { type: XLSX_MIME }));
          } catch (e) {
            toast.error(e);
          }
        }}
      >
        <Download />
        Descargar Ventas
      </Button>
    </div>
  );
}
