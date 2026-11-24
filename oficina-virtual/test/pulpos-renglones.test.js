const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. Debe ir antes de cargar los módulos.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');

const { parseDetalle, aVenta } = require('../src/integraciones/pulpos/parser');
const { materialesDeNota } = require('../src/integraciones/sheets/abreviar');
const { revisarFilas } = require('../src/integraciones/pulpos/robot');
const importador = require('../src/integraciones/importador');
const notas = require('../src/repositories/notas.repo');
const auditoria = require('../src/integraciones/pulpos/auditoria');

// Misma forma que una venta real de Pulpos, con renglones de distintos tipos.
const venta = (renglones, subtotal, extra = '') => `Venta X
Más Acciones
Entregados
Producto
Cantidad
Subtotal
${renglones}
Subtotal
$${subtotal}
Descuentos
$0.00
Total
$${subtotal}
Historial
Entrega de Productos
Estado
Pagada
Total
$${subtotal}
Forma de Entrega
Envío a Domicilio
Enviar a: CALLE 5 CENTRO
Cliente
ING PRUEBA
${extra}`;

const fila = { Venta: 'P1', Fecha: 'Hoy a las 10:00', Cliente: 'ING PRUEBA', Total: '$0', href: '/sales/detail?id=1' };

test('lee los renglones con unidad que antes se perdían', () => {
  const d = parseDetalle(venta(`CTOHOL25
CEMENTO HOLCIM 25 KG
$145.00
Precio Público
6\t$870.00
PVOM3
POLVO POR METRO
$580.00
Precio Público
0.5 metro.\t$290.00
GRAVA POR M3 SIN COSTALES
$600.00
2 metro.\t$1,200.00
LATAPVO
LATA DE POLVO
$20.00
1 lata.\t$20.00
CAL
CAL X KG
$8.00
1.5 kg\t$12.00
MEDIA
ARENA
$100.00
1/2\t$50.00`, '2,442.00'));
  assert.deepEqual(d.productos.map((p) => [p.cantidad, p.unidad, p.nombre, p.subtotal]), [
    [6, null, 'CEMENTO HOLCIM 25 KG', 870],
    [0.5, 'metro', 'POLVO POR METRO', 290],
    [2, 'metro', 'GRAVA POR M3 SIN COSTALES', 1200],
    [1, 'lata', 'LATA DE POLVO', 20],
    [1.5, 'kg', 'CAL X KG', 12],
    ['1/2', null, 'ARENA', 50],
  ]);
  assert.equal(d.productos[1].codigo, 'PVOM3');
  assert.equal(d.productos[2].codigo, null); // no toma el renglón anterior como código
  assert.equal(d.subtotal, 2442);

  const v = aVenta(fila, d, '1');
  assert.deepEqual(v.advertencias, []);
  assert.equal(v.nota.material, 'CEMENTO HOLCIM 25 KG');
  assert.equal(v.nota.detalle.split('\n').length, 6);
  assert.match(v.nota.detalle, /0\.5 × POLVO POR METRO/);
  assert.match(v.nota.detalle, /1 × LATA DE POLVO/);

  const hoja = materialesDeNota({ detalle: v.nota.detalle });
  assert.deepEqual(hoja.cemento, ['6 HOLCIM']);
  assert.ok(hoja.otros.includes('.5M POLVO'));
  assert.ok(hoja.otros.includes('2M GRAVA SIN COSTALES'));
});

test('un solo renglón con unidad fija bien la cantidad y la unidad', () => {
  const v = aVenta(fila, parseDetalle(venta('PVOM3\nPOLVO POR METRO\n$580.00\n0.5 metro.\t$290.00', '290.00')), '1');
  assert.equal(v.nota.cantidad, 0.5);
  assert.equal(v.nota.unidad, 'm³');
  assert.equal(v.nota.detalle, null);
});

test('lo que no cuadra se avisa en la tarjeta, no se pierde', () => {
  // Un renglón con una forma que no se entiende: la suma no da el subtotal.
  const v = aVenta(fila, parseDetalle(venta('A\nGRAVA\n$100.00\n2\t$200.00\nB\nARENA\n$100.00\ndos piezas sin importe', '400.00')), '1');
  assert.match(v.nota.detalle, /⚠️ REVISAR EN PULPOS/);
  assert.match(v.nota.detalle, /suma \$200/);
  assert.match(v.nota.detalle, /2 × GRAVA/);
  assert.deepEqual(materialesDeNota({ detalle: v.nota.detalle }).otros, ['2 GRAVA']); // el aviso no va a la hoja

  const rara = aVenta(fila, parseDetalle(venta('A\nGRAVA\n$100.00\nvarias\t$100.00', '100.00')), '1');
  assert.equal(rara.nota.cantidad, 'varias');
  assert.match(rara.advertencias[0], /cantidad desconocida/);
});

test('si Pulpos cambia la pantalla, la nota entra igual con el aviso', () => {
  const v = aVenta(fila, parseDetalle('Venta X\nForma de Entrega\nEnvío a Domicilio\nEnviar a: CENTRO\nArtículos\nGRAVA 2 $100'), '1');
  assert.match(v.nota.material, /VER EN PULPOS/);
  assert.equal(v.nota.cantidad, 1);
  assert.match(v.nota.detalle, /no se pudo leer ningún producto/);
});

test('descripción muy larga o con caracteres especiales se guarda completa', () => {
  const nombre = `VARILLA 3/8" <b>Ñ&Ü</b> 'A' "B" ⚡ ${'X'.repeat(600)}`;
  const d = parseDetalle(venta(`V1\n${nombre}\n$10.00\n2\t$20.00\nV2\n$$$ 100% (A+B) | "C"\n$5.00\n1\t$5.00`, '25.00'));
  assert.equal(d.productos[0].nombre, nombre);
  assert.equal(d.productos[1].nombre, '$$$ 100% (A+B) | "C"');
  const v = aVenta({ ...fila, Venta: 'LARGA' }, d, '1');
  assert.deepEqual(v.advertencias, []);
  const guardada = notas.obtener(importador.registrar(v).id);
  assert.equal(guardada.material, nombre);
  assert.ok(guardada.detalle.includes(nombre));
});

test('el envío en $0 sigue sin anotarse, como se pidió', () => {
  const v = aVenta(fila, parseDetalle(venta('G\nGRAVA\n$100.00\n1\t$100.00\nENV\nSERVICIO DE ENVIO\n$0.00\n1\t$0.00', '100.00')), '1');
  assert.equal(v.nota.detalle, null);
  assert.deepEqual(v.advertencias, []);
});

test('el registro de auditoría guarda lo crudo y lo leído; devueltas no entran', async () => {
  const desde = new Date(Date.now() - 86_400_000);
  const texto = venta('PVOM3\nPOLVO POR METRO\n$580.00\n0.5 metro.\t$290.00', '290.00');
  const leer = async () => parseDetalle(texto);
  const r = await revisarFilas([
    { ...fila, Venta: 'A1' },
    { ...fila, Venta: 'A2', Pago: 'Reembolsada', Productos: 'Devueltos' },
  ], desde, leer);
  assert.equal(r.nuevas, 1);
  assert.deepEqual(r.devueltas, []);
  const log = fs.readFileSync(auditoria.ARCHIVO, 'utf8');
  assert.match(log, /A1 \| importada/);
  assert.match(log, /0\.5 \| metro \| POLVO POR METRO \| \$290/);
  assert.match(log, /TEXTO DE PULPOS:/);
  assert.match(log, /0\.5 metro\.\t\$290\.00/);
  assert.ok(!log.includes('A2'));

  // Ya en el tablero y luego devuelta en Pulpos: se avisa.
  const d = await revisarFilas([{ ...fila, Venta: 'A1', Pago: 'Reembolsada' }], desde, leer);
  assert.deepEqual(d.devueltas, ['A1']);
});
