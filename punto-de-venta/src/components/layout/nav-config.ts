import { BarChart3, CircleUserRound, Home, Receipt, Settings, Tag, type LucideIcon } from 'lucide-react';

export interface NavLeaf {
  label: string;
  to: string;
}

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  to?: string;
  children?: NavLeaf[];
}

/**
 * Mismo orden y agrupación que el menú de Pulpos (reference/pulpos/navigation.md),
 * limitado a los módulos de este proyecto.
 */
export const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Inicio', icon: Home, to: '/' },
  {
    id: 'products',
    label: 'Productos',
    icon: Tag,
    children: [
      { label: 'Productos', to: '/products' },
    ],
  },
  {
    id: 'sales',
    label: 'Ventas',
    icon: Receipt,
    children: [
      { label: 'Ventas', to: '/sales' },
      { label: 'Caja', to: '/cash' },
      { label: 'Cortes Históricos', to: '/cash/history' },
    ],
  },
  { id: 'clients', label: 'Clientes', icon: CircleUserRound, children: [{ label: 'Clientes', to: '/clients' }] },
  { id: 'reports', label: 'Reportes', icon: BarChart3, to: '/reports' },
];

export const NAV_FOOTER: NavItem[] = [{ id: 'settings', label: 'Preferencias', icon: Settings, to: '/settings' }];

/** Ruta activa: coincidencia exacta para "/" y por prefijo de segmento para el resto. */
export function isPathActive(pathname: string, to: string) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Elige la hoja más específica que coincide (para que /cash/history no active también /cash). */
export function activeLeaf(pathname: string, leaves: NavLeaf[]) {
  return leaves.filter((l) => isPathActive(pathname, l.to)).sort((a, b) => b.to.length - a.to.length)[0];
}

export function groupForPath(pathname: string): string | null {
  const g = NAV_ITEMS.find((i) => i.children && activeLeaf(pathname, i.children));
  return g ? g.id : null;
}

export const APP_NAME = 'Mi Punto de Venta';
