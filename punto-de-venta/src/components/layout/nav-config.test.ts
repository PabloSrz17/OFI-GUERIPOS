import { NAV_ITEMS, activeLeaf, groupForPath, isPathActive } from './nav-config';

const sales = NAV_ITEMS.find((i) => i.id === 'sales')!.children!;

describe('navegación', () => {
  it('"/" solo coincide exacto', () => {
    expect(isPathActive('/', '/')).toBe(true);
    expect(isPathActive('/products', '/')).toBe(false);
  });

  it('coincide por segmento, no por prefijo de texto', () => {
    expect(isPathActive('/cash/history', '/cash')).toBe(true);
    expect(isPathActive('/cashier', '/cash')).toBe(false);
  });

  it('elige la hoja más específica', () => {
    expect(activeLeaf('/cash/history', sales)?.label).toBe('Cortes Históricos');
    expect(activeLeaf('/cash', sales)?.label).toBe('Caja');
  });

  it('abre el grupo de la página actual', () => {
    expect(groupForPath('/products/detail')).toBe('products');
    expect(groupForPath('/clients/detail')).toBe('clients');
    expect(groupForPath('/sales')).toBe('sales');
    expect(groupForPath('/')).toBeNull();
  });
});
