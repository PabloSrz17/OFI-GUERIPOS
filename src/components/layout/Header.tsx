import { ChevronDown, Wifi } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/** Encabezado de 64px, blanco, borde inferior gray-200 (navigation.md). */
export function Header({ userName = 'Usuario' }: { userName?: string }) {
  const initials = userName
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header data-testid="header" className="flex h-header shrink-0 items-center justify-end gap-4 border-b border-gray-200 bg-white pl-8 pr-6">
      {/* Estado de conexión: el sistema opera sin internet; la sincronización llega en la Etapa 7. */}
      <span className="inline-flex items-center gap-2 text-sm font-medium text-gray-500" title="Estado de sincronización">
        <Wifi className="size-4" />
        Trabajando localmente
      </span>
      <span className="h-8 w-px bg-gray-200" aria-hidden="true" />
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-3 rounded-md px-2 py-1 text-left hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
          <span className="flex size-8 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-700">{initials}</span>
          <span className="text-sm font-medium text-gray-900">{userName}</span>
          <ChevronDown className="size-5 text-gray-700" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Mi perfil</DropdownMenuItem>
          <DropdownMenuItem>Cerrar sesión</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
