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
const { materialesDeNota } = require('../src/integraciones/sheets/abreviar');

let folio = 100;
const nueva = (datos) => importador.registrar({
  cliente: { nombre: 'CLIENTE' },
  nota: { origen: 'sicar', folio: String(++folio), material: 'POLVO', cantidad: 10, unidad: 'm³', direccion: 'Centro', zona: 'Norte', telefono: '529811112222', ...datos },
});
const listos = (nota) => {
  notas.asignar(nota.id, 'chofer', db.prepare('INSERT INTO choferes (nombre) VALUES (?)').run('Chofer').lastInsertRowid);
  notas.asignar(nota.id, 'camion', db.prepare('INSERT INTO camiones (nombre) VALUES (?)').run('Camión').lastInsertRowid);
};

test('un producto: la nota lleva lo enviado y el saldo lo restante, con los datos del cliente', () => {
  const nota = nueva();
  const saldo = notas.envioParcial(nota.id, ['4']);
  const viaje = notas.obtener(nota.id);
  assert.equal(viaje.cantidad, 4);
  assert.equal(viaje.saldo, 0);
  assert.equal(saldo.cantidad, 6);
  assert.equal(saldo.unidad, 'm³');
  assert.equal(saldo.material, 'POLVO');
  assert.equal(saldo.saldo, 1);
  assert.equal(saldo.folio, `${nota.folio}-S1`);
  assert.equal(saldo.cliente, 'CLIENTE');
  assert.equal(saldo.direccion, 'Centro');
  assert.equal(saldo.zona, 'Norte');
  assert.equal(saldo.cliente_telefono, '529811112222');
});

test('varios productos: sólo queda en saldo lo que no se fue', () => {
  const nota = nueva({ detalle: '10 m³ POLVO\n20 pz BLOCK\n1/2 m³ GRAVA', total: 5000 });
  const saldo = notas.envioParcial(nota.id, ['7', '20', '0']);
  const viaje = notas.obtener(nota.id);
  assert.equal(viaje.detalle, '7 m³ POLVO\n20 pz BLOCK');
  assert.equal(viaje.total, 5000);
  assert.equal(saldo.detalle, '3 m³ POLVO\n1/2 m³ GRAVA');
  assert.equal(saldo.total, null); // el total no se cuenta dos veces
  assert.deepEqual(materialesDeNota(viaje).otros, ['7M POLVO', '20 BLOCK']);
});

test('el WhatsApp de "va en camino" sólo lista lo que va en este viaje', () => {
  const { enRuta } = require('../src/integraciones/whatsapp/mensajes');
  const nota = nueva({ detalle: '10 m³ POLVO\n20 pz BLOCK' });
  notas.envioParcial(nota.id, ['4', '0']);
  const texto = enRuta(notas.obtener(nota.id));
  assert.match(texto, /4 m³ de polvo/);
  assert.doesNotMatch(texto, /block/i);
});

test('renglón de Pulpos con ×, fracción y aviso: el aviso sigue en ambas partes', () => {
  const nota = nueva({ origen: 'pulpos', cantidad: 1.5, material: 'POLVO POR METRO', detalle: '1.5 × POLVO POR METRO\n⚠️ REVISAR EN PULPOS: algo' });
  const saldo = notas.envioParcial(nota.id, ['1/2']);
  const viaje = notas.obtener(nota.id);
  assert.equal(viaje.detalle, '0.5 × POLVO POR METRO\n⚠️ REVISAR EN PULPOS: algo');
  assert.equal(saldo.detalle, '1 × POLVO POR METRO\n⚠️ REVISAR EN PULPOS: algo');
  assert.deepEqual(materialesDeNota(viaje).otros, ['.5M POLVO']);
  assert.equal(saldo.material, 'POLVO POR METRO');
});

test('renglón sin cantidad: va entero o se queda entero', () => {
  const nota = nueva({ detalle: '5 m³ GRAVA\nmedia carga ARENA' });
  const saldo = notas.envioParcial(nota.id, ['5', '0']);
  assert.equal(notas.obtener(nota.id).material, 'GRAVA');
  assert.equal(saldo.material, 'media carga ARENA');
});

test('rechaza cantidades de más, inválidas o la nota completa, sin cambiar nada', () => {
  const nota = nueva();
  assert.throws(() => notas.envioParcial(nota.id, ['11']), /sólo trae 10/);
  assert.throws(() => notas.envioParcial(nota.id, ['mucho']), /no válida/);
  assert.throws(() => notas.envioParcial(nota.id, ['10']), /no hay saldo/);
  assert.throws(() => notas.envioParcial(nota.id, []), /cambió/);
  assert.equal(notas.obtener(nota.id).cantidad, 10);
});

test('nada enviado: la nota entera pasa a Saldos con su folio, y sin chofer ni camión', () => {
  const nota = nueva();
  listos(nota);
  notas.cambiarEstado(nota.id, 'cargando');
  const saldo = notas.envioParcial(nota.id, ['0']);
  assert.equal(saldo.id, nota.id);
  assert.equal(saldo.folio, nota.folio);
  assert.equal(saldo.estado, 'pendiente');
  assert.equal(saldo.chofer_id, null);
  assert.equal(saldo.camion_id, null);
});

test('un saldo no avanza hasta re-programarlo; luego se reparte como cualquier nota', () => {
  const nota = nueva();
  const saldo = notas.envioParcial(nota.id, ['4']);
  listos(saldo);
  assert.throws(() => notas.cambiarEstado(saldo.id, 'cargando'), /re-prográmala/);
  assert.throws(() => notas.reprogramar(nota.id), /no está en Saldos/);
  const antes = notas.resumen();
  assert.equal(notas.reprogramar(saldo.id).saldo, 0);
  const despues = notas.resumen();
  assert.equal(despues.saldos, antes.saldos - 1);
  assert.equal(despues.pendiente, antes.pendiente + 1);
  assert.equal(notas.cambiarEstado(saldo.id, 'cargando').nota.estado, 'cargando');
});

test('un saldo se puede volver a dividir: conserva el folio base', () => {
  const nota = nueva();
  const s1 = notas.envioParcial(nota.id, ['4']);
  notas.reprogramar(s1.id);
  const s2 = notas.envioParcial(s1.id, ['1']);
  assert.equal(s2.folio, `${nota.folio}-S2`);
  assert.equal(s2.cantidad, 5);
});

// Como la 272 real: viaje con vigas y bovedillas, y saldo sólo de bovedillas.
const conSaldo = () => {
  const nota = nueva({ cantidad: 19, unidad: '', material: 'PZA VIGAS 4.50MT', detalle: '19 PZA VIGAS 4.50MT\n350 PZA BOVEDILLA PROCON 25' });
  const saldo = notas.envioParcial(nota.id, ['19', '100']);
  return { nota, saldo };
};

test('subir el viaje toma del saldo, sin error por pasar el tope de la sub-nota', () => {
  const { nota, saldo } = conSaldo();
  assert.equal(saldo.cantidad, 250);
  const despues = notas.envioParcial(nota.id, ['19', '168']);
  assert.equal(despues.id, saldo.id);
  assert.equal(despues.folio, saldo.folio);
  assert.equal(despues.cantidad, 182);
  assert.equal(notas.obtener(nota.id).detalle, '19 PZA VIGAS 4.50MT\n168 PZA BOVEDILLA PROCON 25');
});

test('bajar el viaje regresa al mismo saldo, sin crear otra tarjeta', () => {
  const { nota, saldo } = conSaldo();
  assert.equal(notas.envioParcial(nota.id, ['19', '40']).cantidad, 310);
  assert.equal(notas.obtenerSiExiste(saldo.id).saldo, 1);
  assert.equal(notas.listarTablero().filter((n) => n.folio.startsWith(`${nota.folio}-S`)).length, 1);
});

test('llevarse todo el saldo cierra su tarjeta', () => {
  const { nota, saldo } = conSaldo();
  assert.equal(notas.envioParcial(nota.id, ['19', '350']), null);
  assert.equal(notas.obtenerSiExiste(saldo.id), undefined);
  assert.equal(notas.obtener(nota.id).detalle, '19 PZA VIGAS 4.50MT\n350 PZA BOVEDILLA PROCON 25');
  assert.throws(() => notas.envioParcial(nota.id, ['19', '350']), /no hay saldo/); // sin saldo, ya es la nota completa
});

test('no se puede enviar más de lo que hay entre viaje y saldo', () => {
  const { nota, saldo } = conSaldo();
  assert.throws(() => notas.envioParcial(nota.id, ['19', '351']), /entre este viaje y el saldo sólo hay 350/);
  assert.equal(notas.obtener(saldo.id).cantidad, 250);
  assert.equal(notas.renglones(nota.id)[1].maximo, 350);
});

test('un producto que sólo está en el saldo se puede subir al viaje', () => {
  const nota = nueva({ detalle: '10 m³ POLVO\n20 pz BLOCK' });
  notas.envioParcial(nota.id, ['10', '0']);
  const [polvo, block] = notas.renglones(nota.id);
  assert.equal(polvo.enSaldo, 0);
  assert.deepEqual([block.va, block.enSaldo, block.maximo], [false, 20, 20]);
  const saldo = notas.envioParcial(nota.id, ['10', '5']);
  assert.equal(saldo.cantidad, 15);
  assert.equal(saldo.material, 'BLOCK');
  assert.equal(notas.obtener(nota.id).detalle, '10 m³ POLVO\n5 pz BLOCK');
});

test('todo en 0 con saldo: se juntan en una sola tarjeta y no hay duplicado', () => {
  const { nota, saldo } = conSaldo();
  const unido = notas.envioParcial(nota.id, ['0', '0']);
  assert.equal(unido.id, nota.id);
  assert.equal(unido.saldo, 1);
  assert.equal(unido.detalle, '19 PZA VIGAS 4.50MT\n350 PZA BOVEDILLA PROCON 25');
  assert.equal(notas.obtenerSiExiste(saldo.id), undefined);
});

test('el saldo de otro folio no se toca', () => {
  const { saldo } = conSaldo();
  const otra = nueva({ cantidad: 5, unidad: '', material: 'PZA BOVEDILLA PROCON 25' });
  assert.throws(() => notas.envioParcial(otra.id, ['6']), /sólo trae 5/);
  assert.equal(notas.obtener(saldo.id).cantidad, 250);
});

test('no se divide una nota que ya salió a ruta', () => {
  const nota = nueva();
  listos(nota);
  notas.cambiarEstado(nota.id, 'cargando');
  notas.cambiarEstado(nota.id, 'en_ruta');
  assert.throws(() => notas.envioParcial(nota.id, ['4']), /Pendiente o Cargando/);
});

test('si devuelven la venta y ya sólo queda el saldo, el robot lo sigue viendo activo', () => {
  const nota = nueva({ origen: 'pulpos' });
  notas.envioParcial(nota.id, ['4']);
  listos(nota);
  notas.cambiarEstado(nota.id, 'cargando');
  notas.cambiarEstado(nota.id, 'en_ruta');
  notas.cambiarEstado(nota.id, 'entregado');
  assert.equal(importador.activa('pulpos', nota.folio), true);
});
