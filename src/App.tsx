import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { PosPage } from '@/pages/PosPage';
import { NotFoundPage, PlaceholderPage } from '@/pages/PlaceholderPage';
import { DesignSystemPage } from '@/pages/design/DesignSystemPage';
import { ProductsListPage } from '@/pages/products/ProductsListPage';
import { ProductEditorPage } from '@/pages/products/ProductEditorPage';
import { ProductDetailPage } from '@/pages/products/ProductDetailPage';
import { ClientsListPage } from '@/pages/clients/ClientsListPage';
import { ClientDetailPage } from '@/pages/clients/ClientDetailPage';
import { SalesListPage } from '@/pages/sales/SalesListPage';
import { SaleDetailPage } from '@/pages/sales/SaleDetailPage';
import { CategoriesPage, SettingsLayout, SettingsProductsPage } from '@/pages/settings/SettingsPages';
import { ClientsSettingsPage, TicketSettingsPage } from '@/pages/settings/SalesSettingsPages';

// HashRouter: la app se sirve desde archivos locales en Tauri, sin servidor que resuelva rutas.
export const routes = [
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/pos', element: <PosPage /> },
      { path: '/products', element: <ProductsListPage /> },
      { path: '/products/add', element: <ProductEditorPage mode="add" /> },
      { path: '/products/edit', element: <ProductEditorPage mode="edit" /> },
      { path: '/products/detail', element: <ProductDetailPage /> },
      { path: '/clients', element: <ClientsListPage /> },
      { path: '/clients/detail', element: <ClientDetailPage /> },
      { path: '/sales', element: <SalesListPage /> },
      { path: '/sales/detail', element: <SaleDetailPage /> },
      { path: '/cash', element: <PlaceholderPage title="Caja" stage={6} /> },
      { path: '/cash/history', element: <PlaceholderPage title="Cortes de Caja" stage={6} /> },
      { path: '/reports', element: <PlaceholderPage title="Reportes" stage={8} /> },
      {
        path: '/settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="/settings/products" replace /> },
          { path: 'products', element: <SettingsProductsPage /> },
          { path: 'product-categories', element: <CategoriesPage /> },
          { path: 'clients', element: <ClientsSettingsPage /> },
          { path: 'tickets', element: <TicketSettingsPage /> },
        ],
      },
      { path: '/design', element: <DesignSystemPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

const router = createHashRouter(routes);

export function App() {
  return <RouterProvider router={router} />;
}
