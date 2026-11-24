import * as React from 'react';
import { DatabaseBackup, Download, Server, Upload, Wifi } from 'lucide-react';
import { PageHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog, useToast } from '@/components/ui/feedback';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useConnection } from '@/db/connection';
import { useDb } from '@/db/hooks';
import { formatRelativeDateTime } from '@/lib/format';
import { backupStatus, downloadBackup, inspectBackup, listServerBackups, restoreBackup, type BackupStatus, type ServerBackup } from '@/backup/backup';

const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const when = (iso: string | null) => (iso ? formatRelativeDateTime(new Date(iso)) : 'Nunca');

/** Preferencias → Respaldo (diseño propio, D31): descargar, restaurar y respaldos automáticos del servidor. */
export function BackupSettingsPage() {
  const db = useDb();
  const toast = useToast();
  const conn = useConnection();
  const server = conn.mode === 'server';
  const [status, setStatus] = React.useState<BackupStatus | null>(null);
  const [autos, setAutos] = React.useState<ServerBackup[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [pending, setPending] = React.useState<null | (Awaited<ReturnType<typeof inspectBackup>> & { name: string })>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const refresh = React.useCallback(async () => {
    setStatus(await backupStatus().catch(() => null));
    setAutos(await listServerBackups().catch(() => []));
  }, []);
  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const download = async () => {
    setBusy(true);
    try {
      const name = await downloadBackup(db);
      toast.success(`Respaldo descargado: ${name}`);
      await refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPending({ ...(await inspectBackup(file)), name: file.name });
    } catch (e) {
      toast.error(e);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      <PageHeader title="Respaldo" />
      <div className="space-y-4">
        <Card className="p-6">
          <div className="flex items-start gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">{server ? <Server className="size-5" /> : <Wifi className="size-5" />}</span>
            <div className="min-w-0 flex-1 text-sm">
              <h3 className="text-base font-semibold text-gray-900">{server ? 'Los datos están en el Servidor POS' : 'Los datos están en este navegador'}</h3>
              <p className="mt-1 text-gray-600">
                {server
                  ? 'Todas las PCs conectadas comparten la misma información. El servidor guarda un respaldo automático cada día en su carpeta "respaldos" (conserva los últimos 30).'
                  : 'Solo esta PC (y este navegador) tiene estos datos. Descarga un respaldo con frecuencia: si se borran los datos del navegador, se pierden.'}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-gray-500">Último respaldo descargado</dt>
                  <dd className="font-medium text-gray-900" data-testid="last-download">
                    {status ? when(status.lastDownload) : '—'}
                  </dd>
                </div>
                {server && (
                  <div>
                    <dt className="text-gray-500">Último respaldo automático</dt>
                    <dd className="font-medium text-gray-900">{status ? when(status.lastAutoBackup) : '—'}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <Button variant="primary" disabled={busy} onClick={download}>
              <DatabaseBackup />
              Descargar Respaldo
            </Button>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="text-base font-semibold text-gray-900">Restaurar Respaldo</h3>
          <p className="mt-1 text-sm text-gray-600">
            Sustituye todos los datos por los de un archivo de respaldo (.sqlite). {server ? 'Todas las PCs se actualizan solas. ' : ''}Antes de reemplazar se guarda una copia de lo que hay ahora.
          </p>
          <input ref={fileRef} type="file" accept=".sqlite,.db,application/vnd.sqlite3,application/octet-stream" className="hidden" aria-label="Archivo de respaldo" onChange={(e) => pick(e.target.files?.[0])} />
          <div className="mt-6 flex justify-end">
            <Button onClick={() => fileRef.current?.click()}>
              <Upload />
              Elegir Archivo…
            </Button>
          </div>
        </Card>

        {server && (
          <Card className="p-6">
            <h3 className="text-base font-semibold text-gray-900">Respaldos en el servidor</h3>
            {autos.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">Todavía no hay respaldos guardados.</p>
            ) : (
              <Table wrapperClassName="mt-4">
                <THead>
                  <TR>
                    <TH>Archivo</TH>
                    <TH>Fecha</TH>
                    <TH align="right">Tamaño</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {autos.map((b) => (
                    <TR key={b.name}>
                      <TD className="font-mono text-xs">{b.name}</TD>
                      <TD>{formatRelativeDateTime(new Date(b.created_at))}</TD>
                      <TD align="right">{size(b.size)}</TD>
                      <TD align="right">
                        <a href={`./api/backups/${encodeURIComponent(b.name)}`} download={b.name} className="inline-flex items-center gap-1 text-sm font-medium text-sky-600 hover:text-sky-700">
                          <Download className="size-4" />
                          Descargar
                        </a>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title="Restaurar respaldo"
        description={
          pending ? (
            <div className="space-y-3">
              <p>
                <strong className="font-medium text-gray-900">{pending.name}</strong> tiene {count(pending.sales, 'venta', 'ventas')}, {count(pending.products, 'producto', 'productos')} y {count(pending.clients, 'cliente', 'clientes')}
                {pending.lastSale ? `; la última venta es de ${formatRelativeDateTime(new Date(pending.lastSale)).toLowerCase()}` : ''}.
              </p>
              <p className="font-medium text-red-800">Todos los datos actuales{server ? ', en todas las PCs,' : ''} se reemplazarán por los del respaldo.</p>
            </div>
          ) : null
        }
        confirmLabel="Restaurar"
        onConfirm={async () => {
          try {
            const r = await restoreBackup(db, pending!.bytes);
            toast.success(server ? `Respaldo restaurado. Lo anterior quedó en ${r.previous}` : 'Respaldo restaurado. Se descargó una copia de lo anterior.');
            await refresh();
          } catch (e) {
            toast.error(e);
          }
        }}
      />
    </>
  );
}
