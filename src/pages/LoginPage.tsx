import * as React from 'react';
import { Eye, EyeOff, Lock, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { APP_NAME } from '@/components/layout/nav-config';
import type { AuthInfo } from '@/db/sync-protocol';

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' }).catch(() => {
    throw new Error('No hay conexión con el Servidor POS. Revisa que la ventana del servidor esté abierta en la PC servidor y vuelve a intentar.');
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data;
}

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? 'text' : 'password'} className="pr-10" />
      <button type="button" className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-gray-500 hover:text-gray-700" aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShow((s) => !s)}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/**
 * Inicio de sesión del Servidor POS (diseño propio, D33). Si todavía no hay usuario y se abre desde la PC servidor,
 * permite crearlo; desde otra PC, explica dónde hacerlo.
 */
export function LoginPage({ auth }: { auth: AuthInfo }) {
  const setup = !auth.configured;
  const [user, setUser] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setup && password !== confirm) return setError('Las contraseñas no coinciden');
    setBusy(true);
    try {
      await post(setup ? './api/setup' : './api/login', { user, password });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-white">
            <Store className="size-5" />
          </span>
          <span className="font-display text-xl font-extrabold text-gray-900">{APP_NAME}</span>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          {setup && !auth.canSetup ? (
            <div className="space-y-2 text-sm text-gray-600" role="alert">
              <h1 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                <Lock className="size-4" />
                Falta crear el usuario
              </h1>
              <p>
                El usuario y la contraseña se crean una sola vez desde la PC servidor: abre <strong className="font-medium text-gray-900">{`http://localhost:${window.location.port || 80}${window.location.pathname}`}</strong> en esa PC.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" aria-label={setup ? 'Crear usuario' : 'Iniciar sesión'}>
              <div>
                <h1 className="text-base font-semibold text-gray-900">{setup ? 'Crear usuario' : 'Iniciar sesión'}</h1>
                <p className="mt-1 text-sm text-gray-500">{setup ? 'Será el acceso de todas las PCs del negocio.' : 'Entra con el usuario del negocio.'}</p>
              </div>
              <Field label="Usuario" htmlFor="login-user">
                <Input id="login-user" autoFocus autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} required />
              </Field>
              <Field label="Contraseña" htmlFor="login-password" help={setup ? 'Al menos 6 caracteres.' : undefined}>
                <PasswordInput id="login-password" autoComplete={setup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
              {setup && (
                <Field label="Confirmar contraseña" htmlFor="login-confirm">
                  <PasswordInput id="login-confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
                </Field>
              )}
              {error && (
                <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              )}
              <Button type="submit" variant="primary" className="w-full" disabled={busy || !user.trim() || !password}>
                {setup ? 'Crear y entrar' : 'Entrar'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
