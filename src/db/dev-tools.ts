import type { Database } from './database';
import { listPriceLists } from '@/repos/categories';
import { createProduct } from '@/repos/products';
import { createClient } from '@/repos/clients';

// Catálogo ficticio para desarrollo y capturas (no son datos del negocio).
const DEMO: [name: string, sku: string, category: string | null, price: number, stock: number, cost?: number][] = [
  ['Abrazadera sin fin 5/8"', 'ABR-058', 'Ferretería', 9, 0, 4.5],
  ['Abrazadera de uña 2"', 'ABR-U2', 'Ferretería', 10, 12, 5],
  ['Abrazadera de uña 3"', 'ABR-U3', 'Ferretería', 12.45, 1, 6],
  ['Abrazadera omega 2"', 'ABR-O2', 'Ferretería', 12, 1],
  ['Alambre recocido', 'ALAM', 'Construcción', 55, 97, 38],
  ['Arena fina bulto', 'ARE-F', 'Construcción', 65, 40, 42],
  ['Brocha 2"', 'BRO-2', 'Pintura', 28, 18, 14],
  ['Cemento gris 25 kg', 'CEM-25', 'Construcción', 220, 33, 180],
  ['Cinta de aislar negra', 'CIN-AIS', 'Eléctrico', 18, 0, 9],
  ['Clavo 2" (kg)', 'CLA-2', 'Ferretería', 48, 25, 30],
  ['Codo PVC 1/2"', 'COD-PVC-12', 'Plomería', 6.5, 120, 2.8],
  ['Contacto doble', 'CON-DOB', 'Eléctrico', 35, 14, 19],
  ['Foco LED 9W', 'FOC-9', 'Eléctrico', 39, 50, 22],
  ['Lija de agua #120', 'LIJ-120', 'Pintura', 9, 3, 4],
  ['Llave de paso 1/2"', 'LLA-12', 'Plomería', 85, -2, 52],
  ['Masilla fibratada 20 kg', 'MAS-20', 'Construcción', 214, -4, 160],
  ['Pegamento PVC 250 ml', 'PEG-PVC', 'Plomería', 74, 9, 45],
  ['Pintura vinílica blanca 4 L', 'PIN-B4', 'Pintura', 389, 6, 260],
  ['Rodillo 9"', 'ROD-9', 'Pintura', 65, 0, 35],
  ['Taquete 1/4" (100 pzas)', 'TAQ-14', 'Ferretería', 32, 22, 15],
  ['Tornillo 1" (100 pzas)', 'TOR-1', 'Ferretería', 45, 30, 22],
  ['Tubo PVC 1/2" 6 m', 'TUB-PVC-12', 'Plomería', 78, 15, 50],
  ['Varilla 3/8"', 'VAR-38', 'Construcción', 145, 60, 118],
  ['Cable calibre 12 (m)', 'CAB-12', 'Eléctrico', 14, 300, 8],
  ['Silicón transparente', 'SIL-T', null, 68, 7, 40],
  ['Thinner 1 L', 'THI-1', 'Pintura', 48, 11, 30],
  ['Instalación eléctrica (hora)', 'SERV-ELE', 'Servicios', 250, 0],
];

// Clientes ficticios (nombres inventados, teléfonos con prefijo 555).
const DEMO_CLIENTS: [first: string, last: string | null, phone: string | null, email: string | null][] = [
  ['Andrea', 'Campos', '5550102030', 'andrea.campos@ejemplo.mx'],
  ['Bruno', 'Díaz', '5550203040', null],
  ['Constructora Ébano', null, '5550304050', 'compras@ebano.ejemplo.mx'],
  ['Daniela', 'Fuentes', null, 'dani.f@ejemplo.mx'],
  ['Ernesto', 'Gálvez', '5550405060', null],
  ['Fabiola', 'Herrera', '5550506070', null],
  ['Gerardo', 'Ibarra', null, null],
  ['Herrería La Joya', null, '5550607080', null],
  ['Iván', 'Juárez', '5550708090', 'ivan.juarez@ejemplo.mx'],
  ['Julia', 'Kuri', '5550809010', null],
];

export function createDevTools(db: Database) {
  return {
    /** Llena la base con el catálogo ficticio (no hace nada si ya hay productos). */
    seedDemo: () =>
      db.write((tx) => {
        if (tx.get('SELECT id FROM products LIMIT 1')) return 0;
        const list = listPriceLists(tx)[0];
        for (const [name, sku, category, price, stock, cost] of DEMO) {
          const service = sku.startsWith('SERV');
          createProduct(tx, {
            type: service ? 'service' : 'product',
            name,
            sku,
            newCategoryName: category,
            initialStock: service ? 0 : stock,
            minStock: service ? 0 : 5,
            costCents: Math.round((cost ?? 0) * 100),
            prices: { [list.id]: Math.round(price * 100) },
          });
        }
        return DEMO.length;
      }),
    /** Agrega clientes ficticios (no hace nada si ya hay clientes). */
    seedClients: () =>
      db.write((tx) => {
        if (tx.get('SELECT id FROM clients LIMIT 1')) return 0;
        for (const [firstName, lastName, phone, email] of DEMO_CLIENTS) createClient(tx, { firstName, lastName, phone, email });
        return DEMO_CLIENTS.length;
      }),
    query: (sql: string) => db.read((q) => q.all(sql)),
  };
}
