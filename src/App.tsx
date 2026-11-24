import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { PosPage } from '@/pages/PosPage';
import { NotFoundPage } from '@/pages/PlaceholderPage';
import { DesignSystemPage } from '@/pages/design/DesignSystemPage';
import { ProductsListPage } from '@/pages/products/ProductsListPage';
import { ProductEditorPage } from '@/pages/products/ProductEditorPage';
import { ProductDetailPage } from '@/pages/products/ProductDetailPage';
import { ReportsIndexPage } from '@/pages/reports/ReportsIndexPage';
import { SalesByClientReport, SalesByPaymentMethodReport, SalesByPeriodReport, SalesByProductReport } from '@/pages/reports/SalesReportPages';
import { InventoryValueReport, MoneyMovementsReport, ReceivablesReport, StockReport } from '@/pages/reports/OtherReportPages';
import { ClientsListPage } from '@/pages/clients/ClientsListPage';
import { ClientDetailPage } from '@/pages/clients/ClientDetailPage';
import { SalesListPage } from '@/pages/sales/SalesListPage';
import { SaleDetailPage } from '@/pages/sales/SaleDetailPage';
import { CategoriesPage, SettingsLayout, SettingsProductsPage } from '@/pages/settings/SettingsPages';
import { CashPage } from '@/pages/cash/CashPage';
import { CutPage } from '@/pages/cash/CutPage';
import { CutsHistoryPage } from '@/pages/cash/CutsHistoryPage';
import { CutDetailPage } from '@/pages/cash/CutDetailPage';
import { ClientsSettingsPage, TicketSettingsPage } from '@/pages/settings/SalesSettingsPages';
import { BackupSettingsPage } from '@/pages/settings/BackupSettingsPage';
import { AccessSettingsPage } from '@/pages/settings/AccessSettingsPage';

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
      { path: '/cash', element: <CashPage /> },
      { path: '/cash/cut', element: <CutPage /> },
      { path: '/cash/history', element: <CutsHistoryPage /> },
      { path: '/cash/history/detail', element: <CutDetailPage /> },
      { path: '/reports', element: <ReportsIndexPage /> },
      { path: '/reports/sales', element: <SalesByPeriodReport /> },
      { path: '/reports/products', element: <SalesByProductReport /> },
      { path: '/reports/payment-methods', element: <SalesByPaymentMethodReport /> },
      { path: '/reports/clients', element: <SalesByClientReport /> },
      { path: '/reports/receivables', element: <ReceivablesReport /> },
      { path: '/reports/transactions', element: <MoneyMovementsReport /> },
      { path: '/reports/stock', element: <StockReport /> },
      { path: '/reports/inventory', element: <InventoryValueReport /> },
      {
        path: '/settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="/settings/products" replace /> },
          { path: 'products', element: <SettingsProductsPage /> },
          { path: 'product-categories', element: <CategoriesPage /> },
          { path: 'clients', element: <ClientsSettingsPage /> },
          { path: 'tickets', element: <TicketSettingsPage /> },
          { path: 'backup', element: <BackupSettingsPage /> },
          { path: 'access', element: <AccessSettingsPage /> },
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
