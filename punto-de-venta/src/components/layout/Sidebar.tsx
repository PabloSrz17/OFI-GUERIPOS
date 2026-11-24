import * as React from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, PlusCircle, Store } from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_NAME, NAV_FOOTER, NAV_ITEMS, activeLeaf, groupForPath, isPathActive, type NavItem } from './nav-config';

// Medidas (navigation.md): ancho 240 / 60, ítems de 32px, padding 6×8, radio 6, texto 14/500 gray-300.
const itemBase = 'relative flex h-8 w-full items-center gap-3 rounded-md px-2 text-sm font-medium transition-colors';
const itemIdle = 'text-gray-300 hover:bg-gray-700 hover:text-white';
const itemActive = 'bg-gray-900 font-semibold text-primary-light';

/** Barra teal de 4px pegada al borde izquierdo del aside (el nav tiene 12px de padding). */
function ActiveBar() {
  return <span aria-hidden="true" className="absolute -left-3 top-0 h-full w-1 rounded-r bg-primary-light" />;
}

function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <Link to="/" className={cn('flex h-[100px] items-center text-white', collapsed ? 'justify-center' : 'gap-2 px-4')} aria-label={APP_NAME}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary">
        <Store className="size-5" />
      </span>
      {!collapsed && <span className="font-display text-lg font-extrabold leading-tight">{APP_NAME}</span>}
    </Link>
  );
}

export function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { pathname } = useLocation();
  const [openGroup, setOpenGroup] = React.useState<string | null>(() => groupForPath(pathname));

  // Al navegar se abre automáticamente el grupo de la página actual (acordeón: uno a la vez).
  React.useEffect(() => {
    const g = groupForPath(pathname);
    if (g) setOpenGroup(g);
  }, [pathname]);

  return (
    <aside
      data-testid="sidebar"
      data-collapsed={collapsed}
      className={cn('flex h-full shrink-0 flex-col bg-gray-800', collapsed ? 'w-sidebar-collapsed' : 'w-sidebar')}
    >
      <Logo collapsed={collapsed} />

      <div className={cn('pb-9', collapsed ? 'px-3' : 'px-3')}>
        <Link
          to="/pos"
          title="Nueva Venta"
          className={cn(
            'flex h-8 items-center rounded-md text-sm font-medium text-gray-200 transition-colors',
            collapsed ? 'w-9 justify-center bg-gray-900 hover:bg-gray-700' : 'gap-3 bg-gray-600 px-2 hover:bg-gray-500',
          )}
        >
          <PlusCircle className="size-4 fill-gray-200 text-gray-600" />
          {!collapsed && 'Nueva Venta'}
        </Link>
      </div>

      <nav aria-label="Principal" className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {NAV_ITEMS.map((item) => (
          <NavEntry
            key={item.id}
            item={item}
            collapsed={collapsed}
            pathname={pathname}
            open={openGroup === item.id}
            onToggle={() => setOpenGroup((g) => (g === item.id ? null : item.id))}
          />
        ))}
      </nav>

      <nav aria-label="Secundaria" className="space-y-1 bg-gray-900 px-3 py-3">
        {NAV_FOOTER.map((item) => (
          <NavEntry key={item.id} item={item} collapsed={collapsed} pathname={pathname} open={false} onToggle={() => {}} />
        ))}
      </nav>
    </aside>
  );
}

interface NavEntryProps {
  item: NavItem;
  collapsed: boolean;
  pathname: string;
  open: boolean;
  onToggle: () => void;
}

function NavEntry({ item, collapsed, pathname, open, onToggle }: NavEntryProps) {
  const Icon = item.icon;

  if (!item.children) {
    const active = isPathActive(pathname, item.to!);
    return (
      <NavLink to={item.to!} title={collapsed ? item.label : undefined} className={cn(itemBase, collapsed && 'justify-center px-0', active ? itemActive : itemIdle)}>
        {active && <ActiveBar />}
        <Icon className={cn('size-4 shrink-0', active ? 'text-primary-light' : 'text-gray-400')} strokeWidth={2.25} />
        {!collapsed && item.label}
      </NavLink>
    );
  }

  const leaf = activeLeaf(pathname, item.children);

  // Colapsado (POS): el icono del grupo lleva a su primera sección.
  if (collapsed) {
    return (
      <NavLink to={item.children[0].to} title={item.label} className={cn(itemBase, 'justify-center px-0', leaf ? itemActive : itemIdle)}>
        {leaf && <ActiveBar />}
        <Icon className={cn('size-4', leaf ? 'text-primary-light' : 'text-gray-400')} strokeWidth={2.25} />
      </NavLink>
    );
  }

  const panelId = `nav-group-${item.id}`;
  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle} className={cn(itemBase, itemIdle, 'text-left')}>
        <Icon className={cn('size-4 shrink-0', leaf ? 'text-primary-light' : 'text-gray-400')} strokeWidth={2.25} />
        <span className="flex-1">{item.label}</span>
        <ChevronDown className={cn('size-4 text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div id={panelId} className="mt-1 space-y-1">
          {item.children.map((c) => {
            const active = leaf?.to === c.to;
            return (
              <NavLink key={c.to} to={c.to} end className={cn(itemBase, 'pl-10', active ? itemActive : itemIdle)}>
                {active && <ActiveBar />}
                {c.label}
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}
