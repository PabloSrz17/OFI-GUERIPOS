import type { Database as SqlJsDatabase } from 'sql.js';

/**
 * Migraciones en SQL estándar de SQLite. Convenciones:
 * - Llaves UUID (TEXT) generadas en el cliente, para poder sincronizar sin colisiones.
 * - Dinero en centavos (INTEGER) para no acumular errores de punto flotante.
 * - Fechas ISO-8601 en UTC (TEXT).
 * - Borrado lógico (`deleted_at`), para que la sincronización pueda propagar eliminaciones.
 */
const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  image TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX categories_name_uq ON categories (name COLLATE NOCASE) WHERE deleted_at IS NULL;

CREATE TABLE brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX brands_name_uq ON brands (name COLLATE NOCASE) WHERE deleted_at IS NULL;

CREATE TABLE price_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX price_lists_name_uq ON price_lists (name COLLATE NOCASE) WHERE deleted_at IS NULL;

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('product', 'service')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  sku TEXT,
  barcode TEXT,
  description TEXT,
  category_id TEXT REFERENCES categories (id),
  brand_id TEXT REFERENCES brands (id),
  unit TEXT NOT NULL DEFAULT 'unit',
  shelf_location TEXT,
  sell_in_pos INTEGER NOT NULL DEFAULT 1,
  requires_prescription INTEGER NOT NULL DEFAULT 0,
  track_stock INTEGER NOT NULL DEFAULT 1,
  cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  cost_mode TEXT NOT NULL DEFAULT 'neto' CHECK (cost_mode IN ('neto', 'bruto')),
  charge_taxes INTEGER NOT NULL DEFAULT 1,
  iva TEXT NOT NULL DEFAULT '16',
  ieps TEXT NOT NULL DEFAULT 'none',
  sat_key TEXT,
  image TEXT,
  search_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX products_active_name ON products (deleted_at, name COLLATE NOCASE);
CREATE INDEX products_category ON products (category_id);
CREATE UNIQUE INDEX products_sku_uq ON products (sku COLLATE NOCASE) WHERE deleted_at IS NULL AND sku IS NOT NULL;
CREATE UNIQUE INDEX products_barcode_uq ON products (barcode) WHERE deleted_at IS NULL AND barcode IS NOT NULL;

CREATE TABLE product_prices (
  product_id TEXT NOT NULL REFERENCES products (id),
  price_list_id TEXT NOT NULL REFERENCES price_lists (id),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (product_id, price_list_id)
);

-- Existencias por ubicación. La cantidad es un acumulado de inventory_movements:
-- nace en 0 y solo cambia al mismo valor que el stock_after del último movimiento (ver triggers).
CREATE TABLE stock_levels (
  product_id TEXT NOT NULL REFERENCES products (id),
  location_id TEXT NOT NULL REFERENCES locations (id),
  quantity REAL NOT NULL DEFAULT 0,
  min_quantity REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (product_id, location_id)
);

CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id),
  location_id TEXT NOT NULL REFERENCES locations (id),
  reason TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity <> 0),
  stock_before REAL NOT NULL,
  stock_after REAL NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  user_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX inventory_movements_product ON inventory_movements (product_id, created_at);

-- Kardex inmutable: los errores se corrigen con un movimiento inverso, nunca editando.
CREATE TRIGGER inventory_movements_no_update BEFORE UPDATE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'Los movimientos de inventario no se pueden modificar'); END;
CREATE TRIGGER inventory_movements_no_delete BEFORE DELETE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'Los movimientos de inventario no se pueden eliminar'); END;

-- Regla de negocio en la propia base: el stock no cambia sin un movimiento.
CREATE TRIGGER stock_levels_insert_zero BEFORE INSERT ON stock_levels
WHEN NEW.quantity <> 0
BEGIN SELECT RAISE(ABORT, 'El stock inicial debe registrarse con un movimiento'); END;
CREATE TRIGGER stock_levels_requires_movement BEFORE UPDATE OF quantity ON stock_levels
WHEN NEW.quantity IS NOT OLD.quantity AND NEW.quantity IS NOT (
  SELECT stock_after FROM inventory_movements
  WHERE product_id = NEW.product_id AND location_id = NEW.location_id
  ORDER BY rowid DESC LIMIT 1
)
BEGIN SELECT RAISE(ABORT, 'No se puede modificar el stock sin un movimiento de inventario'); END;

-- Transactional Outbox: cada cambio deja un evento en la misma transacción.
-- La sincronización con Supabase (Etapa 7) lo envía con id como llave de idempotencia.
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  synced_at TEXT
);
CREATE INDEX outbox_pending ON outbox (synced_at, created_at);
`,
  },
  {
    version: 2,
    sql: `
-- Clientes (reference/pulpos/clients.md). credit_limit_cents NULL = usa el límite predeterminado.
CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL CHECK (length(trim(first_name)) > 0),
  last_name TEXT,
  phone_country TEXT NOT NULL DEFAULT '+52',
  phone TEXT,
  email TEXT,
  price_list_id TEXT REFERENCES price_lists (id),
  credit_limit_cents INTEGER CHECK (credit_limit_cents IS NULL OR credit_limit_cents >= 0),
  comments TEXT,
  address_street TEXT,
  address_ext TEXT,
  address_int TEXT,
  address_zip TEXT,
  address_neighborhood TEXT,
  address_municipality TEXT,
  address_city TEXT,
  address_state TEXT,
  search_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX clients_active_name ON clients (deleted_at, first_name COLLATE NOCASE, last_name COLLATE NOCASE);

-- Preferencias del negocio (clave → valor JSON).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    version: 3,
    sql: `
-- Cajas registradoras. Siempre activas; el corte (Etapa 6) cierra el periodo (decisions.md D2).
CREATE TABLE cash_registers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Venta: el id lo genera el carrito antes de cobrar y sirve de llave de idempotencia
-- (cobrar dos veces el mismo carrito no duplica la venta).
CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  folio INTEGER NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('sale', 'order')),
  location_id TEXT NOT NULL REFERENCES locations (id),
  register_id TEXT NOT NULL REFERENCES cash_registers (id),
  client_id TEXT REFERENCES clients (id),
  price_list_id TEXT REFERENCES price_lists (id),
  note TEXT,
  taxes_removed INTEGER NOT NULL DEFAULT 0,
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL,
  taxes_removed_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'credit_card', 'debit_card', 'transfer', 'credit')),
  received_cents INTEGER,
  change_cents INTEGER NOT NULL DEFAULT 0,
  credit_cents INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('delivered', 'pending')),
  delivered_at TEXT,
  user_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX sales_created ON sales (deleted_at, created_at);
CREATE INDEX sales_client ON sales (client_id, deleted_at);

-- Renglones con la foto del producto al momento de vender (nombre, precio, costo e impuestos).
CREATE TABLE sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales (id),
  position INTEGER NOT NULL,
  product_id TEXT REFERENCES products (id),
  name TEXT NOT NULL,
  sku TEXT,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  price_list_id TEXT REFERENCES price_lists (id),
  gross_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  discount_label TEXT,
  taxes_removed_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  tax_rate REAL NOT NULL,
  tax_cents INTEGER NOT NULL,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  track_stock INTEGER NOT NULL
);
CREATE INDEX sale_items_sale ON sale_items (sale_id, position);
CREATE INDEX sale_items_product ON sale_items (product_id);

-- Dinero recibido por una venta (al cobrar y, en la Etapa 7, los cobros de crédito).
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales (id),
  client_id TEXT REFERENCES clients (id),
  register_id TEXT NOT NULL REFERENCES cash_registers (id),
  kind TEXT NOT NULL CHECK (kind IN ('sale', 'collection')),
  method TEXT NOT NULL CHECK (method IN ('cash', 'credit_card', 'debit_card', 'transfer')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  user_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reversed_at TEXT
);
CREATE INDEX payments_sale ON payments (sale_id);

-- Libro de caja: todo el dinero que entra o sale de una caja, por método. Inmutable.
CREATE TABLE cash_movements (
  id TEXT PRIMARY KEY,
  register_id TEXT NOT NULL REFERENCES cash_registers (id),
  type TEXT NOT NULL CHECK (type IN ('sale', 'sale_deletion', 'collection', 'cash_in', 'cash_out')),
  method TEXT NOT NULL CHECK (method IN ('cash', 'credit_card', 'debit_card', 'transfer')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
  description TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  cut_id TEXT,
  user_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX cash_movements_register ON cash_movements (register_id, cut_id, created_at);
CREATE TRIGGER cash_movements_no_delete BEFORE DELETE ON cash_movements
BEGIN SELECT RAISE(ABORT, 'Los movimientos de caja no se pueden eliminar'); END;
CREATE TRIGGER cash_movements_no_update BEFORE UPDATE ON cash_movements
WHEN NEW.amount_cents IS NOT OLD.amount_cents OR NEW.method IS NOT OLD.method OR NEW.type IS NOT OLD.type OR NEW.register_id IS NOT OLD.register_id
BEGIN SELECT RAISE(ABORT, 'Los movimientos de caja no se pueden modificar'); END;

-- Historial de la venta ("Venta Registrada", "Cobro de $220.00 en Efectivo", comentarios…).
CREATE TABLE sale_events (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales (id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  user_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sale_events_sale ON sale_events (sale_id, created_at);
`,
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Aplica en orden las migraciones pendientes; cada una en su propia transacción. */
export function migrate(db: SqlJsDatabase) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
  const res = db.exec('SELECT coalesce(max(version), 0) FROM schema_migrations');
  const current = Number(res[0]?.values[0]?.[0] ?? 0);
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec('BEGIN;');
    try {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [m.version, new Date().toISOString()]);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }
}
