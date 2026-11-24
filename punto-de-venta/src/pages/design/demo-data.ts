// Datos ficticios solo para el catálogo de diseño (no son datos del negocio).
export interface DemoProduct {
  id: string;
  name: string;
  sku: string;
  stock: number;
  category?: string;
  price: number;
}

export const DEMO_PRODUCTS: DemoProduct[] = [
  { id: '1', name: 'Abrazadera sin fin 5/8"', sku: 'ABR-058', stock: 0, price: 9 },
  { id: '2', name: 'Abrazadera de uña 2"', sku: 'ABR-U2', stock: 12, category: 'Ferretería', price: 10 },
  { id: '3', name: 'Abrazadera de uña 3"', sku: 'ABR-U3', stock: 1, category: 'Ferretería', price: 12.45 },
  { id: '4', name: 'Cemento gris 25 kg', sku: 'CEM-25', stock: 33, category: 'Construcción', price: 220 },
  { id: '5', name: 'Masilla fibratada 20 kg', sku: 'MAS-20', stock: -4, category: 'Construcción', price: 214 },
  { id: '6', name: 'Alambre recocido', sku: 'ALAM', stock: 97, category: 'Construcción', price: 55 },
];
