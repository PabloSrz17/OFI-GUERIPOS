const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. Debe ir antes de cargar los módulos.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');

const db = require('../src/db/connection');
const notas = require('../src/repositories/notas.repo');
const importador = require('../src/integraciones/importador');
const { rescatarEn, buscarFueraEn } = require('../src/integraciones/pulpos/robot');

const detalleTexto = (cliente = 'ANGEL T.', direccion = '') => `Venta X
Entregados
Producto
Cantidad
Subtotal
POL
POLVO POR METRO
$580.00
0.5 metro.\t$290.00
GRA
GRAVA POR METRO
$580.00
1 metro.\t$580.00
Subtotal
$870.00
Total
$870.00
Estado
Pagada
${direccion ? `Forma de Entrega\nEnvío a Domicilio\nEnviar a: ${direccion}\n` : ''}Cliente
${cliente}
Nota`;

const hoy = 'Hoy a las 10:00';
const fila = (Venta, extra = {}) => ({ Venta, Fecha: hoy, Cliente: 'ANGEL T.', Total: '$870.00', Pago: 'Pagada', Productos: 'Entregados', href: `/sales/detail?id=${Venta}`, ...extra });

// Página falsa de Pulpos: sirve la lista y el detalle.
function pulpos(filas, textos = {}) {
  let actual = '';
  return {
    goto: async (url) => { actual = url; },
    waitForFunction: async () => {},
    $: async () => null,
    $$eval: async () => filas,
    $eval: async () => textos[new URL(actual).searchParams.get('id')] ?? detalleTexto(),
  };
}

test('rescata una venta omitida: sin dirección, con marca y sin perder materiales', async () => {
  importador.omitir('pulpos', 'N946', 'sin forma de entrega');
  const r = await rescatarEn(pulpos([fila('N946')]), 'n946 ');
  assert.equal(r.ok, true);
  assert.equal(r.folio, 'N946');
  assert.equal(r.columna, 'pendiente');
  assert.deepEqual(r.productos, ['0.5 metro POLVO POR METRO', '1 metro GRAVA POR METRO']);
  assert.match(r.por_que_no_habia_entrado, /mostrador/);
  assert.ok(r.faltan.includes('dirección o colonia'));
  assert.ok(r.faltan.some((f) => /teléfono/.test(f)));
  assert.deepEqual(r.avisos, []);

  const nota = notas.listarTablero().find((n) => n.folio === 'N946');
  assert.equal(nota.estado, 'pendiente');
  assert.equal(notas.sinDireccion(nota), true);
  assert.match(nota.detalle, /0\.5 × POLVO POR METRO/);
});

test('no duplica, no inventa y no trae devueltas', async () => {
  const dos = await rescatarEn(pulpos([fila('N946')]), 'N946');
  assert.equal(dos.ok, false);
  assert.equal(dos.ya_estaba, true);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM notas WHERE folio = 'N946'`).get().n, 1);

  assert.match((await rescatarEn(pulpos([fila('N1')]), 'N999')).motivo, /no tiene ninguna venta/);
  assert.match((await rescatarEn(pulpos([]), 'N998')).motivo, /no tiene ninguna venta/);
  // N93 no es N934: el folio tiene que ser exacto.
  assert.match((await rescatarEn(pulpos([fila('N934')]), 'N93')).motivo, /no tiene ninguna venta/);
  for (const malo of ['', 'N1; DROP TABLE notas', "' OR 1=1", undefined]) {
    assert.match((await rescatarEn(pulpos([]), malo)).motivo, /no es válido/);
  }
});

test('se busca directo por folio en Pulpos, sin recorrer la lista', async () => {
  const visitadas = [];
  const page = pulpos([fila('N2000')]);
  const ir = page.goto;
  page.goto = async (url) => { visitadas.push(url); return ir(url); };
  assert.equal((await rescatarEn(page, 'N2000')).ok, true);
  assert.match(visitadas[0], /\/sales\?q=N2000&/);
  assert.equal(visitadas.length, 2); // la búsqueda y el detalle de la venta
});

test('rescate forzado: una venta devuelta entra si se pide, con la alerta', async () => {
  const r = await rescatarEn(pulpos([fila('N2', { Pago: 'Reembolsada', Productos: 'Devueltos' })]), 'N2');
  assert.equal(r.ok, true);
  assert.match(r.avisos.join(), /Reembolsada/);
  assert.match(notas.listarTablero().find((n) => n.folio === 'N2').detalle, /⚠️ REVISAR EN PULPOS: en Pulpos está como Reembolsada/);
});

test('con dirección en Pulpos sólo falta lo que falta', async () => {
  const r = await rescatarEn(pulpos([fila('N3')], { N3: detalleTexto('LUIS 9811234567', 'CALLE 8 CENTRO 981 123 4567') }), 'N3');
  assert.equal(r.ok, true);
  assert.ok(!r.faltan.includes('dirección o colonia'));
  assert.ok(!r.faltan.some((f) => /teléfono/.test(f)));
  assert.match(r.por_que_no_habia_entrado, /no la había revisado/);
});

test('sin nombre de cliente lo avisa', async () => {
  const r = await rescatarEn(pulpos([fila('N4', { Cliente: '' })], { N4: detalleTexto('Asignar Cliente') }), 'N4');
  assert.ok(r.faltan.includes('nombre del cliente'));
  assert.equal(r.cliente, 'SIN NOMBRE N4');
});

test('una nota cancelada a mano se puede rescatar si se pide', async () => {
  const n = importador.registrar({ cliente: { nombre: 'X' }, nota: { origen: 'pulpos', folio: 'N5', material: 'GRAVA', cantidad: 1, direccion: 'Centro' } });
  notas.eliminar(n.id);
  const r = await rescatarEn(pulpos([fila('N5')]), 'N5');
  assert.equal(r.ok, true);
  assert.match(r.por_que_no_habia_entrado, /cancelaron/);
});

test('buscar lista lo que no está en el tablero, sin tocar nada', async () => {
  const antes = db.prepare('SELECT COUNT(*) AS n FROM notas').get().n;
  const filas = [fila('N946'), fila('N50', { Cliente: '' }), fila('N51', { Pago: 'Reembolsada' }), fila('N52', { Fecha: '01/01/2020 10:00:00' })];
  const r = await buscarFueraEn(pulpos(filas), 0);
  assert.deepEqual(r.fuera_del_tablero.map((f) => f.folio), ['N50']);
  assert.equal(r.fuera_del_tablero[0].cliente, '(sin cliente)');
  assert.ok(r.en_tablero_sin_direccion.some((n) => n.folio === 'N946'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notas').get().n, antes);
});

test('sin dirección no sale a ruta; al completarla, sí', async () => {
  const nota = notas.listarTablero().find((n) => n.folio === 'N946');
  const chofer = db.prepare("INSERT INTO choferes (nombre) VALUES ('Prueba')").run().lastInsertRowid;
  const camion = db.prepare("INSERT INTO camiones (nombre) VALUES ('Prueba')").run().lastInsertRowid;
  notas.asignar(nota.id, 'chofer', chofer);
  notas.asignar(nota.id, 'camion', camion);
  notas.cambiarEstado(nota.id, 'cargando'); // se puede ir cargando
  assert.throws(() => notas.cambiarEstado(nota.id, 'en_ruta'), /falta la dirección/);

  const n = notas.obtener(nota.id);
  notas.editar(nota.id, { folio: n.folio, cliente_id: n.cliente_id, cantidad: n.cantidad, unidad: n.unidad, material: n.material, detalle: n.detalle, total: n.total, direccion: 'Calle 5, Centro', zona: null, chofer_id: chofer, camion_id: camion });
  assert.equal(notas.cambiarEstado(nota.id, 'en_ruta').nota.estado, 'en_ruta');
});
