import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, DatabaseBackup, WifiOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback';
import { useConnection } from '@/db/connection';
import { useDb, useLiveQuery } from '@/db/hooks';
import { backupDue, backupStatus, downloadBackup } from '@/backup/backup';

/** Sin conexión con el servidor: se puede consultar, pero no vender ni cobrar (D30). */
export function OfflineBanner() {
  const c = useConnection();
  if (c.mode !== 'server' || c.status === 'online') return null;
  return (
    <div role="alert" className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-800">
      <WifiOff className="size-5 shrink-0" />
      <span>
        <strong className="font-semibold">Sin conexión con el Servidor POS.</strong> Puedes consultar, pero no vender, cobrar ni hacer cortes hasta que vuelva. Se reconecta solo.
      </span>
    </div>
  );
}

const SNOOZE_KEY = 'pos.backupReminderSnoozed';

/** Aviso diario (D31): si hay ventas y pasaron más de 24 h sin descargar un respaldo. */
export function BackupReminder() {
  const db = useDb();
  const toast = useToast();
  const { pathname } = useLocation();
  const hasSales = useLiveQuery((tx) => !!tx.get('SELECT 1 FROM sales LIMIT 1'), []) ?? false;
  const [last, setLast] = React.useState<string | null | undefined>(undefined);
  const [snoozed, setSnoozed] = React.useState(() => {
    try {
      return sessionStorage.getItem(SNOOZE_KEY) === '1' || !!(window as unknown as { __posNoReminders?: boolean }).__posNoReminders;
    } catch {
      return false;
    }
  });
  const refresh = React.useCallback(() => backupStatus().then((s) => setLast(s.lastDownload), () => setLast(undefined)), []);
  React.useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 15 * 60_000);
    return () => clearInterval(t);
  }, [refresh, pathname]);
  if (snoozed || last === undefined || !backupDue(last, hasSales) || pathname.startsWith('/pos')) return null;
  return (
    <div role="status" className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-sm text-amber-900" data-testid="backup-reminder">
      <AlertTriangle className="size-5 shrink-0 text-amber-500" />
      <span className="flex-1">{last ? 'Pasaron más de 24 horas desde el último respaldo descargado.' : 'Todavía no has descargado ningún respaldo.'} Guárdalo en una USB o en otra carpeta.</span>
      <Button
        size="sm"
        onClick={async () => {
          try {
            const name = await downloadBackup(db);
            toast.success(`Respaldo descargado: ${name}`);
            await refresh();
          } catch (e) {
            toast.error(e);
          }
        }}
      >
        <DatabaseBackup />
        Descargar Respaldo
      </Button>
      <Link to="/settings/backup" className="font-medium text-amber-900 underline underline-offset-2">
        Ver respaldos
      </Link>
      <button
        type="button"
        aria-label="Recordar después"
        className="rounded p-1 hover:bg-amber-100"
        onClick={() => {
          setSnoozed(true);
          try {
            sessionStorage.setItem(SNOOZE_KEY, '1');
          } catch {
            /* sin almacenamiento */
          }
        }}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
