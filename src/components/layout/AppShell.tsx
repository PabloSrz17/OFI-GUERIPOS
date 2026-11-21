import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

/** Esqueleto: aside (240px, 60px en el POS) + header de 64px + main gris con scroll propio. */
export function AppShell() {
  const { pathname } = useLocation();
  const collapsed = pathname === '/pos' || pathname.startsWith('/pos/');
  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar collapsed={collapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main data-testid="main" className="min-h-0 flex-1 overflow-y-auto bg-gray-100">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
