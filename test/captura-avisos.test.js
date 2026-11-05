const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

// Base de datos de prueba: nunca la real. Debe ir antes de cargar los módulos.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');

const db = require('../src/db/connection');
const bus = require('../src/events/bus');
const notas = require('../src/repositories/notas.repo');
const clientes = require('../src/repositories/clientes.repo');
const importador = require('../src/integraciones/importador');
const { interpretar, datosConEmpaque } = require('../src/integraciones/sicar/texto');
const { materialesDeNota } = require('../src/integraciones/sheets/abreviar');
const { aVenta, parseDetalle } = require('../src/integraciones/pulpos/parser');
const mensajes = require('../src/integraciones/whatsapp/mensajes');
const whatsapp = require('../src/integraciones/whatsapp/cliente');
const avisos = require('../src/integraciones/whatsapp/avisos');

test('cada producto va en su renglón, aunque uno no traiga cantidad', () => {
  const r = interpretar('33300, Damaris Sosa, 7 m3 polvo + 10 bultos cemento + Cal, Calle 5 Centro, tel 981 147 8351');
  assert.equal(r.ok, true);
  assert.deepEqual(r.nota.productos, [
    { cantidad: 7, unidad: 'm³', material: 'POLVO' },
    { cantidad: 10, unidad: 'bulto', material: 'CEMENTO' },
    { cantidad: '', unidad: '', material: 'CAL' },
  ]);
  assert.equal(r.nota.detalle, '7 m³ POLVO\n10 bulto CEMENTO\nCAL');
  assert.equal(r.nota.direccion, 'Calle 5 Centro');
  assert.equal(r.nota.telefono, '529811478351');
  assert.deepEqual(materialesDeNota({ detalle: r.nota.detalle }), { cemento: ['10 CEMENTO'], otros: ['7M POLVO', 'CAL'] });
});

test('B son BOLSAS y CB es CON BOLSA; "bulto" sigue siendo otra unidad', () => {
  const uno = (t) => interpretar(`1, Luis, ${t}, Centro`).nota;
  assert.deepEqual(uno('10 b polvo cb').productos, [{ cantidad: 10, unidad: 'BOLSAS', material: 'POLVO CON BOLSA' }]);
  assert.deepEqual(uno('15 m3 b polvo cb').productos, [{ cantidad: 15, unidad: 'BOLSAS', material: 'POLVO CON BOLSA' }]);
  assert.deepEqual(uno('5 bolsas grava c/b').productos, [{ cantidad: 5, unidad: 'BOLSAS', material: 'GRAVA CON BOLSA' }]);
  assert.deepEqual(uno('1/2 b arena').productos, [{ cantidad: '1/2', unidad: 'BOLSAS', material: 'ARENA' }]);
  assert.equal(uno('10 bultos cemento').unidad, 'bulto');
  assert.equal(uno('7 m3 polvo').unidad, 'm³');
  assert.equal(uno('20 block b').material, 'BLOCK B'); // la B suelta al final no es unidad

  // Lo escrito en los campos se limpia igual.
  const d = datosConEmpaque({ cantidad: 10, unidad: 'b', material: 'POLVO CB', detalle: '10 b POLVO CB\n5 m³ B GRAVA CB\n20 BLOCK B 10\n⚠️ REVISAR CB' });
  assert.equal(d.unidad, 'BOLSAS');
  assert.equal(d.material, 'POLVO CON BOLSA');
  assert.equal(d.detalle, '10 BOLSAS POLVO CON BOLSA\n5 BOLSAS GRAVA CON BOLSA\n20 BLOCK B 10\n⚠️ REVISAR CB');
  const vieja = datosConEmpaque({ cantidad: 4, unidad: 'm³', material: 'B POLVO', detalle: null });
  assert.deepEqual([vieja.unidad, vieja.material], ['BOLSAS', 'POLVO']);

  // La hoja sigue con su forma corta y el cliente lo lee claro.
  assert.deepEqual(materialesDeNota({ detalle: '10 BOLSAS POLVO CON BOLSA\n7 m³ GRAVA' }).otros, ['10 B POLVO C/B', '7M GRAVA']);
  assert.deepEqual(materialesDeNota({ cantidad: 10, unidad: 'BOLSAS', material: 'POLVO CON BOLSA' }).otros, ['10 B POLVO C/B']);
  assert.match(mensajes.enRuta({ folio: 'X', cliente: 'A', cantidad: 10, unidad: 'BOLSAS', material: 'POLVO CON BOLSA' }), /• 10 bolsas de polvo con bolsa/);
});

test('la etiqueta se elige a mano y queda guardada; manda sobre el folio', async () => {
  const { etiquetaOrigen } = await import('../public/js/kanban.js');
  const et = (n) => etiquetaOrigen(n).texto;
  assert.equal(et({ origen: 'sicar', folio: '33219' }), 'SC');
  assert.equal(et({ origen: 'sicar', folio: 'N500' }), 'SALIDA');
  assert.equal(et({ origen: 'sicar', folio: '33219', etiqueta: 'SALIDA' }), 'SALIDA');
  assert.equal(et({ origen: 'sicar', folio: 'N500', etiqueta: 'SC' }), 'SC');
  assert.equal(et({ origen: 'pulpos', folio: 'N500', etiqueta: 'SALIDA' }), 'SALIDA'); // marcada a mano, p. ej. tras un parcial
  assert.equal(et({ origen: 'pulpos', folio: 'N500', etiqueta: null }), 'PS');

  const cliente_id = clientes.obtenerOCrear({ nombre: 'ETIQUETA' });
  const nota = notas.crear({ origen: 'sicar', cliente_id, folio: 'E1', material: 'GRAVA', cantidad: 1, direccion: 'Centro', etiqueta: 'SALIDA' });
  assert.equal(nota.etiqueta, 'SALIDA');
  assert.equal(notas.ponerEtiqueta(nota.id, 'SC').etiqueta, 'SC');
  assert.equal(notas.obtener(nota.id).etiqueta, 'SC');
});

test('si el primero no trae cantidad, la nota toma como principal uno que sí', () => {
  const r = interpretar('33301, Luis, Cal + 7 m3 polvo, Centro');
  assert.equal(r.nota.material, 'POLVO');
  assert.equal(r.nota.detalle, 'CAL\n7 m³ POLVO');
});

test('productos separados con coma ya no se van a la dirección', () => {
  // Como las notas reales 33245 y 33246.
  const r = interpretar('33245, Jose Luis, 10 B polvo c/b, 5 B GRAVA C/B, EN EL PARQUE LINDAVISTA');
  assert.equal(r.nota.direccion, 'EN EL PARQUE LINDAVISTA');
  assert.match(r.nota.detalle, /5 BOLSAS GRAVA CON BOLSA/);

  const envio = interpretar('33246, Luis, 3 m3 grava, 1 ENVIO, Calle 8');
  assert.equal(envio.nota.direccion, 'Calle 8');
  assert.match(envio.nota.detalle, /1 pz ENVIO/);
});

test('una dirección que empieza con número sigue siendo dirección', () => {
  for (const dir of ['20 de Noviembre 5', '5 de Mayo, Centro', '12 x 15 Centro', '3 Reyes']) {
    const r = interpretar(`33302, Luis, 7 m3 polvo, ${dir}`);
    assert.ok(r.nota.direccion.startsWith(dir.split(',')[0]), dir);
    assert.equal(r.nota.detalle, null, dir);
  }
  assert.match(interpretar('33303, Luis, Calle 5 + Centro').error, /productos/); // no hay ninguno con cantidad
});

test('el teléfono de la nota manda sobre el del cliente, y uno vacío usa el del cliente', () => {
  const cliente_id = clientes.obtenerOCrear({ nombre: 'CON TEL', telefono: '529811111111' });
  const base = { origen: 'sicar', cliente_id, material: 'GRAVA', cantidad: 1, direccion: 'Centro' };
  assert.equal(notas.crear({ ...base, folio: 'T1', telefono: '529812222222' }).cliente_telefono, '529812222222');
  assert.equal(notas.crear({ ...base, folio: 'T2' }).cliente_telefono, '529811111111');

  const texto = `Venta\nProducto\nCantidad\nSubtotal\nGRAVA\n$100.00\n1\t$100.00\nSubtotal\n$100.00\nTotal\n$100.00\nForma de Entrega\nEnvío a Domicilio\nEnviar a: CENTRO 981 333 4444\nCliente\nCON TEL`;
  const v = aVenta({ Venta: 'T3', Fecha: '' }, parseDetalle(texto), 'x');
  assert.equal(importador.registrar(v).cliente_telefono, '529813334444'); // PS igual que SC
});

test('el formulario guarda los renglones, el teléfono y rechaza uno inválido', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/notas', require('../src/routes/notas.routes'));
  const servidor = await new Promise((listo) => { const s = app.listen(0, '127.0.0.1', () => listo(s)); });
  const url = `http://127.0.0.1:${servidor.address().port}/api/notas`;
  const enviar = (ruta, metodo, cuerpo) => fetch(url + ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  try {
    const cuerpo = { origen: 'sicar', folio: 'F1', cliente: 'NUEVO', telefono: '981 147 8351', cantidad: '1/2', unidad: 'm³', material: 'POLVO', detalle: '1/2 m³ POLVO\nCAL', direccion: 'Centro', total: '', hora: '' };
    const r = await enviar('', 'POST', cuerpo);
    assert.equal(r.status, 201);
    const nota = await r.json();
    assert.equal(nota.cliente_telefono, '529811478351');
    assert.equal(nota.cantidad, '1/2');
    assert.equal((await enviar('', 'POST', { ...cuerpo, folio: 'F2', telefono: '123' })).status, 400);

    // Corregirlo antes de salir a ruta vale para la nota y queda en el cliente.
    const cambio = await enviar(`/${nota.id}/telefono`, 'PATCH', { telefono: '981 000 1111' });
    assert.equal((await cambio.json()).cliente_telefono, '529810001111');
    assert.equal(clientes.obtener(nota.cliente_id).telefono, '529810001111');
    assert.equal((await enviar(`/${nota.id}/telefono`, 'PATCH', { telefono: 'abc' })).status, 400);
  } finally {
    servidor.close();
  }
});

test('el único aviso es al salir a ruta, una sola vez; al cargar y en ALMACÉN no se manda nada', async () => {
  const enviados = [];
  whatsapp.estaListo = () => true;
  whatsapp.enviar = async (tel, texto) => { enviados.push([tel, texto]); return true; };
  avisos.config.esperaMs = 5; // en la Oficina espera un minuto por las demás notas del viaje
  avisos.iniciar();
  const espera = () => new Promise((r) => setTimeout(r, 30));
  const chofer = db.prepare("INSERT INTO choferes (nombre) VALUES ('Prueba')").run().lastInsertRowid;
  const camion = db.prepare("INSERT INTO camiones (nombre) VALUES ('Prueba')").run().lastInsertRowid;
  const nueva = (folio, telefono, origen = 'sicar') => importador.registrar({
    cliente: { nombre: `C ${folio}` },
    nota: { origen, folio, material: 'POLVO', cantidad: 7, unidad: 'm³', detalle: '7 m³ POLVO\n10 bulto CEMENTO', direccion: 'Centro', telefono },
  });
  const paso = async (id, estado) => {
    bus.emit('nota:estado', { ...notas.cambiarEstado(id, estado), retroceso: false });
    await espera();
  };

  for (const [folio, origen] of [['A1', 'sicar'], ['A2', 'pulpos']]) {
    enviados.length = 0;
    const { id } = nueva(folio, '529811478351', origen);
    notas.asignar(id, 'chofer', chofer);
    notas.asignar(id, 'camion', camion);
    await paso(id, 'cargando');
    assert.equal(enviados.length, 0, folio);

    await paso(id, 'en_ruta');
    assert.equal(enviados.length, 1, folio);
    assert.equal(enviados[0][0], '529811478351');
    assert.match(enviados[0][1], /ya va en camino/);
    assert.match(enviados[0][1], /• 7 m³ polvo\n• 10 bulto cemento/);

    // Regresar y volver a avanzar no repite el aviso.
    bus.emit('nota:estado', { ...notas.regresar(id), retroceso: true });
    await espera();
    await paso(id, 'en_ruta');
    assert.equal(enviados.length, 1);
  }

  enviados.length = 0;
  const almacen = db.prepare('SELECT id FROM choferes WHERE almacen = 1').get().id;
  const a = nueva('A3', '529811478351');
  notas.asignar(a.id, 'chofer', almacen);
  await paso(a.id, 'cargando');
  await paso(a.id, 'entregado');
  assert.equal(enviados.length, 0);
  assert.equal(mensajes.cargando, undefined);
});

test('el mensaje de ruta lleva un renglón por producto', () => {
  assert.match(mensajes.enRuta({ folio: 'X', cliente: 'A', detalle: '1/2 m³ POLVO\nCAL', material: 'POLVO' }), /• 1\/2 m³ polvo\n• cal/);
});

test('varias notas del mismo número en el mismo viaje: un solo WhatsApp con todos los folios y materiales', async () => {
  const enviados = [];
  whatsapp.estaListo = () => true;
  whatsapp.enviar = async (tel, texto) => { enviados.push([tel, texto]); return true; };
  avisos.config.esperaMs = 20;
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const chofer = db.prepare("INSERT INTO choferes (nombre) VALUES ('Agrupa')").run().lastInsertRowid;
  const camion = db.prepare("INSERT INTO camiones (nombre) VALUES ('Ram Agrupa')").run().lastInsertRowid;
  const nota = (folio, telefono, material) => {
    const { id } = importador.registrar({
      cliente: { nombre: `JUAN ${telefono}` },
      nota: { origen: 'sicar', folio, material, cantidad: 2, unidad: 'm³', direccion: 'Centro', telefono },
    });
    notas.asignar(id, 'chofer', chofer);
    notas.asignar(id, 'camion', camion);
    notas.cambiarEstado(id, 'cargando');
    return id;
  };
  const aRuta = (id) => bus.emit('nota:estado', { ...notas.cambiarEstado(id, 'en_ruta'), retroceso: false });

  const a = nota('G280', '529811000001', 'GRAVA');
  const b = nota('GN1002', '529811000001', 'ARENA');
  const c = nota('GN1004', '529811000001', 'POLVO');
  const otro = nota('G300', '529811000002', 'CAL'); // otro cliente: su propio mensaje
  aRuta(a); await espera(5); aRuta(b); aRuta(otro); await espera(5); aRuta(c);
  await espera(80);

  const delCliente = enviados.filter(([tel]) => tel === '529811000001');
  assert.equal(delCliente.length, 1);
  assert.match(delCliente[0][1], /Tus pedidos \*G280, GN1002 y GN1004\* ya van en camino/);
  assert.match(delCliente[0][1], /grava/);
  assert.match(delCliente[0][1], /arena/);
  assert.match(delCliente[0][1], /polvo/);
  assert.equal(enviados.filter(([tel]) => tel === '529811000002').length, 1);
  for (const id of [a, b, c]) assert.equal(notas.obtener(id).whatsapp, 'enviado');
});
