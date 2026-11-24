import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Building2, KeyRound, LogOut, Server, Wifi, WifiOff } from 'lucide-react';
import { useConnection } from '@/db/connection';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/** Dónde están los datos: en este navegador, en el Servidor POS, o sin conexión con él (D30). */
function ConnectionIndicator() {
  const c = useConnection();
  const [Icon, text, tone, title] =
    c.mode === 'local'
      ? [Wifi, 'Trabajando localmente', 'text-gray-500', 'Los datos se guardan en este navegador']
      : c.status === 'online'
        ? [Server, 'Conectado al servidor', 'text-green-700', 'Los datos se guardan en el Servidor POS y se comparten con las demás PCs']
        : [WifiOff, 'Sin conexión con el servidor', 'text-red-700', 'No se puede vender ni cobrar hasta que vuelva la conexión'];
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm font-medium', tone)} title={title} data-testid="connection">
      <Icon className="size-4" />
      {text}
    </span>
  );
}

/** Encabezado de 64px, blanco, borde inferior gray-200 (navigation.md). */
export function Header() {
  const c = useConnection();
  const navigate = useNavigate();
  const userName = c.mode === 'server' && c.user ? c.user : 'Usuario';
  const initials = userName
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header data-testid="header" className="flex h-header shrink-0 items-center justify-end gap-4 border-b border-gray-200 bg-white pl-8 pr-6">
      {c.home && (
        <a
          href={c.home}
          className="mr-auto inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          title="Volver a la Oficina Virtual - Materiales"
        >
          <ArrowLeft className="size-4" />
          <Building2 className="size-4 text-amber-700" />
          Oficina Virtual
        </a>
      )}
      <ConnectionIndicator />
      <span className="h-8 w-px bg-gray-200" aria-hidden="true" />
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-3 rounded-md px-2 py-1 text-left hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
          <span className="flex size-8 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-700">{initials}</span>
          <span className="text-sm font-medium text-gray-900">{userName}</span>
          <ChevronDown className="size-5 text-gray-700" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {c.mode === 'server' ? (
            <>
              <DropdownMenuItem icon={<KeyRound />} onSelect={() => navigate('/settings/access')}>
                Cambiar contraseña
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<LogOut />}
                onSelect={async () => {
                  await fetch('./api/logout', { method: 'POST' }).catch(() => null);
                  window.location.reload();
                }}
              >
                Cerrar sesión
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem disabled>Sin inicio de sesión: los datos están en este navegador</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
