// @vitest-environment node
import { createTestDb, openTestDb } from '@/db/test-db';
import type { Database } from '@/db/database';
import { createPriceList, listPriceLists } from './categories';
import {
  clientName,
  clientPhone,
  clientsCsv,
  createClient,
  DEFAULT_CREDIT_LIMIT_KEY,
  deleteClients,
  effectiveCreditLimit,
  formatAddress,
  getClient,
  listClients,
  patchClient,
  setSetting,
  updateClient,
} from './clients';
import { ValidationError } from './common';
import { LATEST_VERSION } from '@/db/migrations';

let db: Database;
beforeEach(async () => {
  db = await createTestDb();
});

const names = async (q: Parameters<typeof listClients>[1] = {}) => (await db.read((t) => listClients(t, q))).rows.map(clientName);

describe('clientes', () => {
  it('crea con datos básicos, dirección y outbox en la misma transacción', async () => {
    const id = await db.write((tx) =>
      createClient(tx, { firstName: ' Adela ', lastName: 'Paredes', phone: '981 105-2126', email: 'adela@correo.mx', comments: 'Hay unos pilares', address: { street: 'Sufrimiento', zip: '24000', neighborhood: 'San Rafael', city: 'Campeche', state: 'Campeche' } }),
    );
    const c = (await db.read((t) => getClient(t, id)))!;
    expect(clientName(c)).toBe('Adela Paredes');
    expect(clientPhone(c)).toBe('+529811052126');
    expect(formatAddress(c)).toBe('Sufrimiento, San Rafael, CP 24000, Campeche, Campeche');
    expect(c.comments).toBe('Hay unos pilares');
    expect(await db.read((t) => t.get<{ n: number }>("SELECT count(*) n FROM outbox WHERE entity = 'client'")!.n)).toBe(1);
  });

  it('valida nombre, email y teléfono', async () => {
    await expect(db.write((tx) => createClient(tx, { firstName: '  ' }))).rejects.toThrow('Indica el nombre del cliente');
    await expect(db.write((tx) => createClient(tx, { firstName: 'A', email: 'malo@' }))).rejects.toMatchObject({ field: 'email' });
    await expect(db.write((tx) => createClient(tx, { firstName: 'A', phone: '98a1' }))).rejects.toBeInstanceOf(ValidationError);
    expect(await names()).toEqual([]);
  });

  it('busca por nombre sin acentos, teléfono o email; ordena y pagina', async () => {
    await db.write((tx) => {
      createClient(tx, { firstName: 'Martín', lastName: 'Ávila', phone: '9811111111' });
      createClient(tx, { firstName: 'ana', email: 'ana@x.mx' });
      createClient(tx, { firstName: 'Zoé' });
    });
    expect(await names({ q: 'martin avila' })).toEqual(['Martín Ávila']);
    expect(await names({ q: '981111' })).toEqual(['Martín Ávila']);
    expect(await names({ q: 'ANA@X' })).toEqual(['ana']);
    expect(await names()).toEqual(['ana', 'Martín Ávila', 'Zoé']);
    expect(await names({ sort: 'name-desc' })).toEqual(['Zoé', 'Martín Ávila', 'ana']);
    expect(await names({ sort: 'created-desc' })).toHaveLength(3);
    const r = await db.read((t) => listClients(t, { pageSize: 2, page: 5 }));
    expect(r).toMatchObject({ total: 3, totalPages: 2, page: 2 });
  });

  it('lista de precios asignada y filtro por lista', async () => {
    const mayoreo = await db.write((tx) => createPriceList(tx, 'Mayoreo'));
    const id = await db.write((tx) => createClient(tx, { firstName: 'Ferretería López', priceListId: mayoreo }));
    await db.write((tx) => createClient(tx, { firstName: 'Otro' }));
    expect((await db.read((t) => getClient(t, id)))!.price_list_name).toBe('Mayoreo');
    expect(await names({ priceListId: mayoreo })).toEqual(['Ferretería López']);
    await db.write((tx) => patchClient(tx, id, { priceListId: null }));
    expect((await db.read((t) => getClient(t, id)))!.price_list_id).toBeNull();
    expect((await db.read(listPriceLists)).length).toBe(2);
  });

  it('límite de crédito: predeterminado (sin limitar) o personalizado', async () => {
    const id = await db.write((tx) => createClient(tx, { firstName: 'A' }));
    const limit = () => db.read((t) => effectiveCreditLimit(t, getClient(t, id)!));
    expect(await limit()).toBeNull();
    await db.write((tx) => setSetting(tx, DEFAULT_CREDIT_LIMIT_KEY, 500000));
    expect(await limit()).toBe(500000);
    await db.write((tx) => patchClient(tx, id, { creditLimitCents: 100000 }));
    expect(await limit()).toBe(100000);
    await expect(db.write((tx) => patchClient(tx, id, { creditLimitCents: -1 }))).rejects.toThrow('positivo');
  });

  it('editar conserva el id; eliminar es lógico', async () => {
    const id = await db.write((tx) => createClient(tx, { firstName: 'A', comments: 'x' }));
    await db.write((tx) => updateClient(tx, id, { firstName: 'B', lastName: 'C' }));
    expect(clientName((await db.read((t) => getClient(t, id)))!)).toBe('B C');
    expect(await db.write((tx) => deleteClients(tx, [id, id]))).toBe(1);
    expect(await db.read((t) => getClient(t, id))).toBeNull();
    expect(await db.read((t) => t.get<{ n: number }>('SELECT count(*) n FROM clients')!.n)).toBe(1);
  });

  it('exporta CSV', async () => {
    await db.write((tx) => createClient(tx, { firstName: 'Juan, el de la esquina', phone: '9811234567' }));
    const csv = await db.read(clientsCsv);
    expect(csv).toContain('"Juan, el de la esquina",,+529811234567');
  });

  it('migra una base de la Etapa 3 sin perder datos', async () => {
    let bytes: Uint8Array | null = null;
    const pdb = await createTestDb(async (b) => {
      bytes = b;
    });
    await pdb.write((tx) => {
      tx.run('DELETE FROM schema_migrations WHERE version >= 2');
      for (const t of ['cash_cut_lines', 'cash_movements', 'cash_cuts', 'sale_events', 'sale_items', 'payments', 'collections', 'sales', 'cash_registers', 'clients', 'settings']) tx.run(`DROP TABLE ${t}`);
    });
    const reopened = await openTestDb(bytes!);
    expect(await reopened.read((t) => t.get<{ v: number }>('SELECT max(version) v FROM schema_migrations')!.v)).toBe(LATEST_VERSION);
    await reopened.write((tx) => createClient(tx, { firstName: 'Nuevo' }));
  });
});
