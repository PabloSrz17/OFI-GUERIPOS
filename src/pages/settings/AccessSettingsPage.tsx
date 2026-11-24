import * as React from 'react';
import { KeyRound, Monitor, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/feedback';
import { useConnection } from '@/db/connection';

/** Preferencias → Acceso (diseño propio, D33): usuario de la sesión y cambio de contraseña. */
export function AccessSettingsPage() {
  const conn = useConnection();
  const toast = useToast();
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [urls, setUrls] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    fetch('./api/info', { cache: 'no-store' })
      .then((r) => r.json())
      .then((i: { urls?: string[] }) => setUrls(i.urls ?? []))
      .catch(() => setUrls([]));
  }, []);

  if (conn.mode !== 'server')
    return (
      <>
        <PageHeader title="Acceso" />
        <Card className="p-6 text-sm text-gray-600">
          <h3 className="text-base font-semibold text-gray-900">Sin inicio de sesión</h3>
          <p className="mt-1">Esta ventana trabaja con los datos de este navegador. El usuario y la contraseña se usan cuando el POS se abre desde el Servidor POS.</p>
        </Card>
      </>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) return setError('Las contraseñas nuevas no coinciden');
    setBusy(true);
    try {
      const res = await fetch('./api/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ current, next }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success('Contraseña cambiada. Las demás PCs tendrán que volver a iniciar sesión.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Acceso" />
      <div className="space-y-4">
        <Card className="p-6">
          <div className="flex items-start gap-4 text-sm">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
              <ShieldCheck className="size-5" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Sesión iniciada como {conn.user}</h3>
              <p className="mt-1 text-gray-600">Todas las PCs entran con este usuario. La sesión dura 30 días en cada navegador; después vuelve a pedir la contraseña.</p>
            </div>
          </div>
        </Card>
        {urls && urls.length > 0 && (
          <Card className="p-6">
            <div className="flex items-start gap-4 text-sm">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                <Monitor className="size-5" />
              </span>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Dirección para las otras PCs</h3>
                <p className="mt-1 text-gray-600">Ábrela en el navegador de cada PC del negocio y guárdala en favoritos.</p>
                <ul className="mt-2 space-y-1" aria-label="Direcciones del servidor">
                  {urls.map((u) => (
                    <li key={u} className="font-mono text-base font-medium text-gray-900">
                      {u}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        )}
        <Card className="p-6">
          <form onSubmit={submit} aria-label="Cambiar contraseña">
            <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
              <KeyRound className="size-4" />
              Cambiar contraseña
            </h3>
            <div className="mt-4 grid max-w-md gap-4">
              <Field label="Contraseña actual" htmlFor="pw-current">
                <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
              </Field>
              <Field label="Contraseña nueva" htmlFor="pw-next" help="Al menos 6 caracteres.">
                <Input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
              </Field>
              <Field label="Confirmar contraseña nueva" htmlFor="pw-confirm">
                <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </Field>
              {error && (
                <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              )}
            </div>
            <div className="mt-6 flex justify-end">
              <Button type="submit" variant="primary" disabled={busy || !current || !next || !confirm}>
                Cambiar contraseña
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
