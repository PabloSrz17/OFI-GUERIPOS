const test = require('node:test');
const assert = require('node:assert/strict');

const cargar = () => import('../public/js/leer-ticket.js');

// Texto tal como lo devolvió Tesseract con una captura real de Pulpos (quitados los datos del negocio).
const PULPOS = `pulpos (2 ¡Envíanos Sugerencias! E Asistente Tvatar Y
O Nueva Venta < Venta N968 Más Acciones v (O Descargar PDF (3) Facturar Venta
Y Entregados Estado  Pagada
Producto Cantidad — Subtotal
Total $150.00 Hola .
CTOMAY25 ¿En qué te puedo ayudar hoy?
CEMENTO MAYA 25 KG CEMEX 1. 150.00
cargas $150.00 . .
Promociones Subtotal $150.00 de la venta?
Total $150.00 ¿Cuánto vendí esta semana? >
Cortes Históricos Hoy alas 11:38
O Ciientes N ¿Cómo cancelo una venta y ,
1 Contra separe
Preferencias E) Cobro de $150.00 en Efectivo Hoy alas 11:38`;

// Texto tal como lo devolvió Tesseract con el PDF real de SICAR de la nota 33249.
const PDF_SICAR = `une MAQ-RENT CONSTRUCCIONES te
ai. MCOOSOLlI711A ce 981308 0000
ame o EN LAS BODEGAS DE CRUZ AZUL YENDO AL AEROPUERTO , C.P.: 24095
cadas + MÉXICO
Coma
CANT UNI DESCRIPCIÓN P. UNIT. IMPORTE
25.0 PZA VIGA DE 4.00 $ 488.00 $ 12.200.00
2.0 PZA VIGA DE 5.60 $ 683.20 $ 1.366.40
2.0 PZA VIGA DE 2.60 $ 317.20 $ 634.40
4.0 PZA VIGA DE 1.30 $ 158.60 $ 634.40
19.0 PZA VIGA DE 4.40 $ 536.80 $ 10.199.20
1.0 PZA VIGA DE 1.90 $ 231.80 $ 231.80
940.0 PZA BOVEDILLA PROCON 15X25X56 $28.85 $ 27.119.00
2.0 PZA ROLLO DE MALLA ELECTROSOLDADA 66-1010 $ 2.565.00 $ 5.130.00
25.0 PZA ARMEX DE CASTILLO 15X15-4 12X12X4 6 ML $ 188.00 $ 4.700.00
100.0 PZA ALAMBRON $37.00 $ 3.700.00
20.0 PIEZA VARILLA DE 3/8” CORRUGADA $ 171.00 $ 3.420.00
5.0 PZA VIGA DE 2.00 $ 244.00 $ 1.220.00`;

// Lo mismo con la foto real del impreso: mal leído a propósito, así salió.
const FOTO_SICAR = `MATERIALES EL GUERO
| CANPECHE, CAMPECHE 24090 -
y nateriales_elguero8outook.c 9811348812 -
TICKET FECHA —
Lo 33249 30/10/2026 02:41 PM T
ve MELO 7.0 12,200.00 -
_ VIGA DE 1.90 1.0 231.80 -
_ DOVEDILLA PROCON 15125156 940.0 21,119.00 ,
DOMICILIO EN LAS BODEGAS DE CRUZ AZUL
COLONTA AL AEROPUERTO
E LTENTEIÓN E 0000`;

test('PDF real de SICAR: los 12 artículos, cliente, celular, dirección y total por suma', async () => {
  const { interpretarTicket } = await cargar();
  const d = interpretarTicket(PDF_SICAR);
  assert.equal(d.cliente, 'MAQ-RENT CONSTRUCCIONES');
  assert.equal(d.telefono, '981 308 0000');
  assert.equal(d.direccion, 'EN LAS BODEGAS DE CRUZ AZUL YENDO AL AEROPUERTO');
  assert.equal(d.total, '70555.20');
  assert.equal(d.dudas, undefined);
  assert.equal(d.articulos.length, 12);
  assert.deepEqual(d.articulos[0], { cantidad: '25', unidad: 'pz', material: 'VIGA DE 4.00' });
  assert.deepEqual(d.articulos[3], { cantidad: '4', unidad: 'pz', material: 'VIGA DE 1.30' });
  assert.deepEqual(d.articulos[6], { cantidad: '940', unidad: 'pz', material: 'BOVEDILLA PROCON 15X25X56' });
  assert.deepEqual(d.articulos[8], { cantidad: '25', unidad: 'pz', material: 'ARMEX DE CASTILLO 15X15-4 12X12X4 6 ML' });
  assert.deepEqual(d.articulos[11], { cantidad: '5', unidad: 'pz', material: 'VIGA DE 2.00' });
});

test('si un importe no cuadra con cantidad por precio, avisa y no inventa el total', async () => {
  const { interpretarTicket } = await cargar();
  const d = interpretarTicket(PDF_SICAR.replace('940.0 PZA', '900.0 PZA'));
  assert.equal(d.dudas, 1);
  assert.equal(d.total, undefined);
});

test('foto real del impreso: folio y hora de 12 horas; nunca el teléfono del negocio', async () => {
  const { interpretarTicket } = await cargar();
  const d = interpretarTicket(FOTO_SICAR);
  assert.equal(d.folio, '33249');
  assert.equal(d.hora, '14:41');
  assert.equal(d.telefono, undefined);
  assert.equal(d.direccion, 'EN LAS BODEGAS DE CRUZ AZUL');
});

test('formato de renglón del impreso: la medida de la viga no se toma como cantidad', async () => {
  const { interpretarTicket } = await cargar();
  const d = interpretarTicket('VIGA DE 2.00 5.0 1,220.00\nTOTAL: 1,220.00');
  assert.deepEqual(d.articulos, [{ cantidad: '5', unidad: '', material: 'VIGA DE 2.00' }]);
  assert.equal(d.total, '1220');
  assert.equal(d.dudas, undefined);
  assert.equal(interpretarTicket('VIGA DE 2.00 5.0 1,220.00\nTOTAL: 9,999.00').dudas, 1);
});

test('captura real de Pulpos: folio, hora, total y sólo el artículo verdadero', async () => {
  const { interpretarTicket } = await cargar();
  const d = interpretarTicket(PULPOS);
  assert.equal(d.folio, 'N968');
  assert.equal(d.hora, '11:38');
  assert.equal(d.total, '150');
  assert.deepEqual(d.articulos, [{ cantidad: '1', unidad: '', material: 'CEMENTO MAYA 25 KG CEMEX' }]);
  assert.equal(d.cliente, undefined);
});

test('ticket impreso: cantidad al inicio, unidades, precios, cliente, dirección y teléfono', async () => {
  const { interpretarTicket } = await cargar();
  const d = interpretarTicket(`MATERIALES
Folio: 33245
Fecha: 31/10/2026 10:25
Cliente: Luis Roman
Domicilio: Calle 5 #20 Centro
Tel. 981 196 5122
7 m3 POLVO 550.00 3,850.00
10 BULTOS CEMENTO MAYA 150.00 1,500.00
1/2 m3 GRAVA 275.00
Subtotal 5,625.00
TOTAL: $5,625.00
Efectivo 6,000.00`);
  assert.equal(d.folio, '33245');
  assert.equal(d.cliente, 'LUIS ROMAN');
  assert.equal(d.direccion, 'Calle 5 #20 Centro');
  assert.equal(d.telefono, '981 196 5122');
  assert.equal(d.total, '5625');
  assert.equal(d.hora, '10:25');
  assert.deepEqual(d.articulos, [
    { cantidad: '7', unidad: 'm³', material: 'POLVO' },
    { cantidad: '10', unidad: 'bulto', material: 'CEMENTO MAYA' },
    { cantidad: '1/2', unidad: 'm³', material: 'GRAVA' },
  ]);
});

test('una calle no es un artículo; la etiqueta en otro renglón sí se lee', async () => {
  const { interpretarTicket } = await cargar();
  const d = interpretarTicket('Cliente\nANA PEREZ\n20 de Noviembre\nCEMENTO MAYA 12 150.00 1,800.00');
  assert.equal(d.cliente, 'ANA PEREZ');
  assert.deepEqual(d.articulos, [{ cantidad: '12', unidad: '', material: 'CEMENTO MAYA' }]);
});

test('sin datos reconocibles no llena nada', async () => {
  const { interpretarTicket } = await cargar();
  assert.deepEqual(interpretarTicket('e . ! r a Al MN\nNS |\n6\nY - Eo'), {});
  assert.deepEqual(interpretarTicket(''), {});
});
