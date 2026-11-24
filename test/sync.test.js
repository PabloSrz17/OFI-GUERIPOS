// Sincronización Principal ↔ Mostrador: dos bases en memoria con el esquema real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { crearMotor } = require('../src/sync/motor');

const ESQUEMA = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');

function base(rol) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(ESQUEMA);
  const log = console.log;
  console.log = () => {};
  try {
    require('../src/db/migraciones')(db);
  } finally {
    console.log = log;
  }
  const motor = crearMotor(db, { rol });
  motor.instalar();
  return { db, motor };
}

/** `a` trae todo lo nuevo de `b`, como lo hace el servidor (por páginas). */
function traer(a, b) {
  const par = a.motor.par();
  let desde = par?.version ?? 0;
  const cambios = [];
  let r;
  do {
    r = b.motor.cambiosDesde(desde, { limite: 3, par: a.motor.nodo() });
    cambios.push(...r.cambios);
    desde = r.hasta;
  } while (r.mas);
  return a.motor.aplicar(cambios, { nodo: r.nodo, version: desde });
}
const sincronizar = (p, m) => [traer(m, p), traer(p, m)];

function cliente(db, nombre) {
  return db.prepare('INSERT INTO clientes (nombre, telefono) VALUES (?, ?)').run(nombre, '5215500000000').lastInsertRowid;
}
function nota(db, folio, clienteId, origen = 'sicar') {
  return db
    .prepare("INSERT INTO notas (origen, folio, cliente_id, material, cantidad, direccion) VALUES (?, ?, ?, 'Arena', 1, 'Calle 1')")
    .run(origen, folio, clienteId).lastInsertRowid;
}
function cotizacion(db, clienteId, total) {
  const id = db.prepare('INSERT INTO cotizaciones (cliente_id, total) VALUES (?, ?)').run(clienteId, total).lastInsertRowid;
  db.prepare("INSERT INTO cotizacion_partidas (cotizacion_id, orden, descripcion, cantidad, unidad, precio, importe) VALUES (?, 1, 'Grava', 1, 'm³', ?, ?)").run(id, total, total);
  return id;
}
const contar = (db, t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

test('el Mostrador arranca con una copia del Principal', () => {
  const p = base('primary');
  const c = cliente(p.db, 'ANA');
  cotizacion(p.db, c, 500);
  const m = base('secondary');
  const r = m.motor.inicializar(p.motor.foto());
  assert.equal(r.modo, 'copia');
  assert.equal(contar(m.db, 'clientes'), contar(p.db, 'clientes'));
  assert.equal(contar(m.db, 'precios'), contar(p.db, 'precios'));
  assert.equal(m.db.prepare('SELECT nombre FROM clientes WHERE id = ?').get(c).nombre, 'ANA');
  assert.ok(cliente(m.db, 'BETO') > c);
  // Lo copiado no se vuelve a mandar al Principal.
  assert.deepEqual(p.motor.cambiosDesde(0).cambios.filter((x) => x.tabla === 'clientes').length, 1);
});

test('cada lado trabaja sin el otro y al reconectar se juntan sin repetir folios', () => {
  const p = base('primary');
  const m = base('secondary');
  m.motor.inicializar(p.motor.foto());
  // Separados, los dos crean el mismo número de cliente y de cotización.
  const cm = cliente(m.db, 'MOSTRADOR SA');
  const cotM = cotizacion(m.db, cm, 1200);
  m.db.prepare("INSERT INTO historial_estados (nota_id, estado_nuevo) VALUES (?, 'pendiente')").run(nota(m.db, 'M-1', cm, 'manual'));
  const cp = cliente(p.db, 'OFICINA SA');
  const cotP = cotizacion(p.db, cp, 800);
  assert.equal(cotM, cotP); // el choque que hay que resolver

  for (let i = 0; i < 3; i++) sincronizar(p, m);
  for (const { db } of [p, m]) {
    const cots = db.prepare('SELECT co.id, co.total, cl.nombre FROM cotizaciones co JOIN clientes cl ON cl.id = co.cliente_id ORDER BY co.total').all();
    assert.deepEqual(cots.map((c) => [c.total, c.nombre]), [[800, 'OFICINA SA'], [1200, 'MOSTRADOR SA']]);
    assert.equal(cots.find((c) => c.total === 800).id, cotP); // el Principal conserva su número
    const partidas = db.prepare('SELECT co.total, p.importe FROM cotizacion_partidas p JOIN cotizaciones co ON co.id = p.cotizacion_id ORDER BY co.total').all();
    assert.deepEqual(partidas.map((x) => x.total), [800, 1200]);
    assert.ok(partidas.every((x) => x.importe === x.total));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM historial_estados h JOIN notas n ON n.id = h.nota_id WHERE n.folio = 'M-1'").get().n, 1);
  }
  assert.equal(contar(p.db, 'sync_conflictos') + contar(m.db, 'sync_conflictos'), 0);
  // Ya no hay nada que traer (sin eco).
  const [a, b] = sincronizar(p, m);
  assert.equal(a.aplicados + b.aplicados, 0);
  // Otra vez separados y con el mismo número: se vuelve a resolver.
  const otraP = cotizacion(p.db, cp, 5);
  assert.equal(cotizacion(m.db, cm, 6), otraP);
  for (let i = 0; i < 2; i++) sincronizar(p, m);
  for (const { db } of [p, m]) assert.deepEqual(db.prepare('SELECT total FROM cotizaciones ORDER BY total').all().map((c) => c.total), [5, 6, 800, 1200]);
});

test('si los dos cambian la misma nota, gana el cambio más reciente; los borrados también viajan', async () => {
  const p = base('primary');
  const c = cliente(p.db, 'ANA');
  const n = nota(p.db, '100', c);
  const m = base('secondary');
  m.motor.inicializar(p.motor.foto());

  p.db.prepare("UPDATE notas SET estado = 'cargando' WHERE id = ?").run(n);
  await new Promise((r) => setTimeout(r, 5));
  m.db.prepare("UPDATE notas SET estado = 'entregado' WHERE id = ?").run(n);
  const [enM, enP] = sincronizar(p, m);
  assert.equal(enM.saltados, 1); // el Mostrador ya tenía lo más nuevo
  assert.deepEqual(enP.estados, [{ id: n, anterior: 'cargando', nuevo: 'entregado' }]);
  for (const { db } of [p, m]) assert.equal(db.prepare('SELECT estado FROM notas WHERE id = ?').get(n).estado, 'entregado');

  m.db.prepare('DELETE FROM notas WHERE id = ?').run(n);
  sincronizar(p, m);
  assert.equal(p.db.prepare('SELECT COUNT(*) AS n FROM notas WHERE id = ?').get(n).n, 0);
});

test('la misma venta importada en los dos lados se funde en una sola nota con todo su historial', async () => {
  const p = base('primary');
  const c = cliente(p.db, 'ANA');
  const m = base('secondary');
  m.motor.inicializar(p.motor.foto());

  const np = nota(p.db, '777', c);
  p.db.prepare("INSERT INTO historial_estados (nota_id, estado_nuevo) VALUES (?, 'pendiente')").run(np);
  await new Promise((r) => setTimeout(r, 5)); // el Mostrador la mandó a ruta después
  const nm = nota(m.db, '777', c);
  m.db.prepare("INSERT INTO historial_estados (nota_id, estado_nuevo) VALUES (?, 'en_ruta')").run(nm);
  m.db.prepare("UPDATE notas SET estado = 'en_ruta' WHERE id = ?").run(nm);

  for (let i = 0; i < 3; i++) sincronizar(p, m);
  for (const { db } of [p, m]) {
    const filas = db.prepare("SELECT id, estado FROM notas WHERE folio = '777'").all();
    assert.deepEqual(filas, [{ id: np, estado: 'en_ruta' }]);
    assert.deepEqual(
      db.prepare('SELECT estado_nuevo FROM historial_estados WHERE nota_id = ? ORDER BY estado_nuevo').all(np).map((h) => h.estado_nuevo),
      ['en_ruta', 'pendiente'],
    );
  }
});

test('si el Mostrador trabajó antes de la primera copia, se mezcla sin perder lo suyo', () => {
  const p = base('primary');
  cliente(p.db, 'ANA');
  const m = base('secondary');
  const propio = cliente(m.db, 'BETO');
  const r = m.motor.inicializar(p.motor.foto());
  assert.equal(r.modo, 'mezcla');
  assert.equal(r.renumerados.length, 1); // BETO tenía el número de ANA
  traer(p, m);
  for (const { db } of [p, m]) assert.deepEqual(db.prepare('SELECT nombre FROM clientes ORDER BY id').all().map((c) => c.nombre), ['ANA', 'BETO']);
  assert.ok(propio);
});

test('el choque de números se resuelve igual si el Principal es el primero en traer', async () => {
  const p = base('primary');
  const c = cliente(p.db, 'ANA');
  const m = base('secondary');
  m.motor.inicializar(p.motor.foto());
  const np = nota(p.db, '500', c);
  await new Promise((r) => setTimeout(r, 5));
  const nm = nota(m.db, '501', c, 'manual');
  m.db.prepare("INSERT INTO historial_estados (nota_id, estado_nuevo) VALUES (?, 'pendiente')").run(nm);
  assert.equal(np, nm);
  for (let i = 0; i < 3; i++) {
    traer(p, m); // el Principal primero
    traer(m, p);
  }
  for (const { db } of [p, m]) {
    assert.deepEqual(db.prepare('SELECT folio FROM notas ORDER BY id').all().map((n) => n.folio), ['500', '501']);
    assert.equal(db.prepare('SELECT id FROM notas WHERE folio = ?').get('500').id, np);
    assert.equal(db.prepare("SELECT n.folio FROM historial_estados h JOIN notas n ON n.id = h.nota_id").get().folio, '501');
  }
});
