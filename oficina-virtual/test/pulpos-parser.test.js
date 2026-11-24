const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFecha, parseDetalle, aVenta, unidadDe } = require('../src/integraciones/pulpos/parser');

// Texto con la misma estructura que el detalle de venta de Pulpos (datos ficticios).
const DETALLE = `Venta N900
Más Acciones
No Entregados
Producto
Cantidad
Subtotal
POL7
POLVO M3
$350.00
Precio Público
7 $2,450.00
FLE01
FLETE ZONA NORTE
$300.00
Precio Mayoreo
1 $300.00
Entregar Productos
Subtotal
$2,750.00
Descuentos
$0.00
Total
$2,750.00
Estado
Pagada
Total
$2,750.00
Forma de Entrega
Envío a Domicilio
Enviar a: AV. INDUSTRIAL 450, COL. CENTRO
Ver mapa
Cliente
CONSTRUCTORA PRUEBA
Nota
Añadir Nota`;

test('parseFecha entiende Hoy, Ayer y fecha completa', () => {
  const ahora = new Date(2026, 9, 29, 12, 0);
  assert.deepEqual(parseFecha('Hoy a las 11:16', ahora), new Date(2026, 9, 29, 11, 16));
  assert.deepEqual(parseFecha('Ayer a las 08:07', ahora), new Date(2026, 9, 28, 8, 7));
  assert.deepEqual(parseFecha('27/10/2026 11:51:29', ahora), new Date(2026, 9, 27, 11, 51));
  assert.equal(parseFecha('—', ahora), null);
});

test('parseDetalle extrae partidas, entrega, dirección, cliente y total', () => {
  const d = parseDetalle(DETALLE);
  assert.deepEqual(d.productos, [
    { codigo: 'POL7', nombre: 'POLVO M3', cantidad: 7, unidad: null, subtotal: 2450 },
    { codigo: 'FLE01', nombre: 'FLETE ZONA NORTE', cantidad: 1, unidad: null, subtotal: 300 },
  ]);
  assert.equal(d.formaEntrega, 'Envío a Domicilio');
  assert.equal(d.direccion, 'AV. INDUSTRIAL 450, COL. CENTRO');
  assert.equal(d.cliente, 'CONSTRUCTORA PRUEBA');
  assert.equal(d.total, 2750);
});

test('aVenta arma la nota para el tablero', () => {
  const fila = { Venta: 'N900', Cliente: 'CONSTRUCTORA P.', Fecha: 'Ayer a las 08:05' };
  const venta = aVenta(fila, parseDetalle(DETALLE), 'abc123', new Date(2026, 9, 29, 12, 0));
  assert.equal(venta.nota.creado_en, '2026-10-28 08:05:00');
  assert.equal(venta.cliente.nombre, 'CONSTRUCTORA PRUEBA');
  assert.equal(venta.cliente.telefono, null); // la dirección de prueba no trae teléfono
  assert.equal(venta.nota.folio, 'N900');
  assert.equal(venta.nota.material, 'POLVO M3');
  assert.equal(venta.nota.cantidad, 7);
  assert.equal(venta.nota.unidad, 'm³');
  assert.equal(venta.nota.detalle, '7 × POLVO M3\n1 × FLETE ZONA NORTE');
  assert.equal(venta.nota.id_externo, 'abc123');
});

test('aVenta no anota el envío en $0, pero sí el que tiene costo', () => {
  const nota = (subtotal) => aVenta({ Venta: 'N1' }, { productos: [
    { nombre: 'GRAVA M3', cantidad: 1, subtotal: 550 },
    { nombre: 'SERVICIO DE ENVIO', cantidad: 1, subtotal },
  ] }).nota;
  assert.equal(nota(0).material, 'GRAVA M3');
  assert.equal(nota(0).detalle, null);
  assert.equal(nota(100).detalle, '1 × GRAVA M3\n1 × SERVICIO DE ENVIO');
});

test('sin productos legibles la nota entra igual, con aviso', () => {
  const v = aVenta({ Venta: 'N1' }, { productos: [], subtotal: null });
  assert.match(v.nota.material, /VER EN PULPOS/);
  assert.match(v.advertencias[0], /ningún producto/);
});

test('unidadDe', () => {
  assert.equal(unidadDe('GRAVA 3/4 M3'), 'm³');
  assert.equal(unidadDe('VIAJE DE ESCOMBRO'), 'viaje');
  assert.equal(unidadDe('CEMENTO HOLCIM 25 KG'), 'pz');
});
