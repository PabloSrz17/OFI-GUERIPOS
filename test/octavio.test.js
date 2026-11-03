const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. Sin clave de IA: no se gasta ni sale nada.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');
delete process.env.ANTHROPIC_API_KEY;

const whatsapp = require('../src/integraciones/whatsapp/cliente');
const imagen = require('../src/integraciones/inspector/imagen');
const ordenes = require('../src/integraciones/octavio/ordenes');
const solicitudes = require('../src/integraciones/inspector/solicitudes');

let numero = 5219810000100;
function persona() {
  numero += 1;
  return String(numero);
}
const mensaje = (tel, body, extra = {}) => ({
  type: 'chat',
  from: `${tel}@c.us`,
  body,
  timestamp: Math.floor(Date.now() / 1000),
  getContact: async () => ({ id: { user: tel }, pushname: 'Concordia' }),
  client: { sendMessage: async () => { throw new Error('Octavio no contesta sin aprobación'); } },
  ...extra,
});
const deTel = (tel) => ordenes.listar().filter((o) => o.clave === `52${tel.slice(-10)}`);
const ultimaDe = (tel) => deTel(tel).sort((a, b) => b.id - a.id)[0];

const AVISO = 'Octavio te mando esta orden de compra';
const salidas = [];
whatsapp.estaListo = () => true;
whatsapp.enviar = async (t, texto) => { salidas.push({ t, texto }); return true; };
whatsapp.enviarImagen = async (t, png, nombre, pie) => { salidas.push({ t, png, nombre, pie }); return true; };
imagen.generarOrdenPNG = async () => Buffer.from('png');

test('el aviso se reconoce con o sin acentos; otros mensajes no', () => {
  assert.ok(ordenes.esOrden(AVISO));
  assert.ok(ordenes.esOrden('OCTAVIO te mando esta ÓRDEN DE COMPRA'));
  assert.ok(!ordenes.esOrden('Te mando esta orden de compra'));
  assert.ok(!ordenes.esOrden('Hola Octavio'));
  for (const t of ['Octavio, orden', 'octavio una compra', 'OCTAVIO te mandó esto', 'Octavio: órdenes']) assert.ok(ordenes.esOrden(t), t);
  for (const t of ['Octavio comando', 'Octavio desorden', 'Octavio quiero comprar', 'mando la orden de compra']) assert.ok(!ordenes.esOrden(t), t);
});

test('el nombre y la palabra se juntan entre mensajes, en cualquier orden, con la lista de antes', async () => {
  for (const [uno, dos] of [['Octavio', 'te mando esto'], ['es una compra', 'para Octavio']]) {
    const tel = persona();
    await solicitudes.procesarMensaje(mensaje(tel, '7 m3 polvo'));
    await solicitudes.procesarMensaje(mensaje(tel, uno));
    assert.equal(deTel(tel).length, 0);
    await solicitudes.procesarMensaje(mensaje(tel, dos));
    assert.equal(ultimaDe(tel).estado, 'por_aprobar');
    assert.deepEqual(ultimaDe(tel).renglones, [{ cantidad: '7', unidad: 'm³', material: 'POLVO' }]);
    assert.equal(deTel(tel).length, 1);
  }
});

test('la ventana es de 2 minutos y por remitente', async () => {
  const hace = (s) => ({ timestamp: Math.floor(Date.now() / 1000) - s });
  const tarde = persona();
  await solicitudes.procesarMensaje(mensaje(tarde, 'Octavio', hace(125)));
  await solicitudes.procesarMensaje(mensaje(tarde, 'te mando esto'));
  assert.equal(deTel(tarde).length, 0);

  const justo = persona();
  await solicitudes.procesarMensaje(mensaje(justo, 'Octavio', hace(110)));
  await solicitudes.procesarMensaje(mensaje(justo, 'te mando esto'));
  assert.equal(deTel(justo).length, 1);

  const a = persona();
  const b = persona();
  await solicitudes.procesarMensaje(mensaje(a, 'Octavio'));
  await solicitudes.procesarMensaje(mensaje(b, 'te mando esto'));
  assert.equal(deTel(a).length + deTel(b).length, 0);
});

test('con una orden abierta las palabras sueltas se suman: no abren otra alerta', async () => {
  const tel = persona();
  await solicitudes.procesarMensaje(mensaje(tel, `${AVISO}\n1 pz malla`));
  await solicitudes.procesarMensaje(mensaje(tel, 'gracias Octavio'));
  await solicitudes.procesarMensaje(mensaje(tel, 'te mando 2 pz varilla'));
  assert.equal(deTel(tel).length, 1);
  assert.deepEqual(ultimaDe(tel).renglones.map((r) => r.material), ['MALLA', 'VARILLA']);
});

test('renglones: cantidad primero o al final, viñetas y fracciones; lo demás no es lista', () => {
  assert.deepEqual(ordenes.renglonesDeTexto(`${AVISO}:\n- 10 bultos cemento maya\n1. 5 pz varilla 3/8\ncal 3 bultos\n1/2 m3 grava\ngracias, es para el lunes`), [
    { cantidad: '10', unidad: 'bulto', material: 'CEMENTO MAYA' },
    { cantidad: '5', unidad: 'pz', material: 'VARILLA 3/8' },
    { cantidad: '3', unidad: 'bulto', material: 'CAL' },
    { cantidad: '1/2', unidad: 'm³', material: 'GRAVA' },
  ]);
  assert.deepEqual(ordenes.renglonesDeTexto('10 bultos cemento, 5 pz varilla').map((r) => r.material), ['CEMENTO', 'VARILLA']);
  for (const t of ['Octavio te mando 3 bultos cal', 'Octavio, orden de 3 bultos cal', 'Octavio compra: cal 3 bultos']) {
    assert.deepEqual(ordenes.renglonesDeTexto(t), [{ cantidad: '3', unidad: 'bulto', material: 'CAL' }], t);
  }
  assert.deepEqual(ordenes.renglonesDeTexto('3 bultos cal de compra').map((r) => r.cantidad), ['3']);
});

test('la orden sale por aprobar, sin contestar nada, y lo siguiente se suma a ella', async () => {
  const tel = persona();
  await solicitudes.procesarMensaje(mensaje(tel, AVISO));
  let o = ultimaDe(tel);
  assert.equal(o.estado, 'por_aprobar');
  assert.equal(o.solicitante, 'CONCORDIA');
  assert.equal(o.sucursal, 'Concordia');
  assert.deepEqual(o.renglones, []);
  await solicitudes.procesarMensaje(mensaje(tel, '10 bultos cemento\n5 pz varilla'));
  o = ultimaDe(tel);
  assert.equal(deTel(tel).length, 1);
  assert.equal(o.renglones.length, 2);
  assert.deepEqual(o.original, o.renglones);
});

test('la lista mandada justo antes del aviso entra a la orden', async () => {
  const tel = persona();
  await solicitudes.procesarMensaje(mensaje(tel, '7 m3 polvo'));
  assert.equal(deTel(tel).length, 0);
  await solicitudes.procesarMensaje(mensaje(tel, AVISO));
  assert.deepEqual(ultimaDe(tel).renglones, [{ cantidad: '7', unidad: 'm³', material: 'POLVO' }]);
});

test('una cotización después del aviso sigue con Chatito, no se suma a la orden', async () => {
  const tel = persona();
  let bienvenidas = 0;
  await solicitudes.procesarMensaje(mensaje(tel, AVISO));
  await solicitudes.procesarMensaje(mensaje(tel, 'cotizar 3 m3 grava', { client: { sendMessage: async () => { bienvenidas += 1; } } }));
  assert.deepEqual(ultimaDe(tel).renglones, []);
  assert.equal(bienvenidas, 1);
});

test('un segundo aviso con otra orden en curso abre otra alerta', async () => {
  const tel = persona();
  await solicitudes.procesarMensaje(mensaje(tel, `${AVISO}\n1 pz malla`));
  await solicitudes.procesarMensaje(mensaje(tel, `${AVISO}\n2 pz malla`));
  assert.equal(deTel(tel).length, 2);
});

const datos = (o, renglones = o.renglones) => ({ telefono: o.telefono, solicitante: o.solicitante, sucursal: o.sucursal, renglones });

test('Caso B: aprobada sin cambios responde con la imagen', async () => {
  const tel = persona();
  await solicitudes.procesarMensaje(mensaje(tel, `${AVISO}\n10 bultos cemento`));
  const o = ultimaDe(tel);
  salidas.length = 0;
  assert.equal(ordenes.aprobar(o.id, datos(o, ordenes.validarRenglones([{ cantidad: '10.0', unidad: 'bulto', material: 'cemento' }]))), true);
  const guardada = ordenes.obtener(o.id);
  assert.equal(await ordenes.responder(guardada), 'enviado');
  assert.equal(salidas.length, 1);
  assert.equal(salidas[0].pie, '¡Claro que sí! Aquí tienes tu orden:');
  assert.equal(salidas[0].nombre, `OC-${o.id}.png`);
  assert.equal(ordenes.obtener(o.id).estado, 'aprobada');
  assert.equal(ordenes.obtener(o.id).whatsapp, 'enviado');
});

test('Caso A: con cantidades cambiadas responde con la lista autorizada, sin imagen', async () => {
  const tel = persona();
  await solicitudes.procesarMensaje(mensaje(tel, `${AVISO}\n10 bultos cemento\n5 pz varilla`));
  const o = ultimaDe(tel);
  salidas.length = 0;
  ordenes.aprobar(o.id, datos(o, [{ ...o.renglones[0], cantidad: '8' }, { ...o.renglones[1], cantidad: '0' }]));
  assert.equal(await ordenes.responder(ordenes.obtener(o.id)), 'enviado');
  assert.deepEqual(salidas.map((s) => s.texto), ['Me autorizaron estas cantidades:\n- 8 bulto CEMENTO\n- 0 pz VARILLA']);
});

test('no se aprueba dos veces, y si WhatsApp falla queda anotado para reenviar', async () => {
  const tel = persona();
  await solicitudes.procesarMensaje(mensaje(tel, `${AVISO}\n1 pz malla`));
  const o = ultimaDe(tel);
  assert.equal(ordenes.aprobar(o.id, datos(o)), true);
  assert.equal(ordenes.aprobar(o.id, datos(o)), false);
  const original = whatsapp.enviarImagen;
  whatsapp.enviarImagen = async () => { throw new Error('se cayó'); };
  assert.equal(await ordenes.responder(ordenes.obtener(o.id)), 'error');
  whatsapp.enviarImagen = original;
  assert.equal(ordenes.obtener(o.id).whatsapp, 'error');
  assert.equal(ordenes.obtener(o.id).estado, 'aprobada');
});

test('validación: cantidades inválidas, y al menos un material con cantidad', () => {
  assert.throws(() => ordenes.validarRenglones([{ cantidad: 'x', material: 'cal' }]), /Cantidad inválida en CAL/);
  assert.throws(() => ordenes.validarRenglones([{ cantidad: '', material: 'cal' }]), /Cantidad inválida/);
  assert.throws(() => ordenes.validarRenglones([{ cantidad: '0', material: 'cal' }]), /al menos un material/);
  assert.throws(() => ordenes.validarRenglones([]), /al menos un material/);
  assert.deepEqual(ordenes.validarRenglones([{ cantidad: '2', material: ' cal ' }, { cantidad: '', material: '' }]), [{ cantidad: '2', unidad: '', material: 'CAL' }]);
});

test('en el pizarrón se edita productos y estatus; lo por aprobar o descartado no', async () => {
  const tel = persona();
  await solicitudes.procesarMensaje(mensaje(tel, `${AVISO}\n1 pz malla`));
  const o = ultimaDe(tel);
  assert.equal(ordenes.editar(o.id, { ...datos(o), estado: 'surtida' }), false);
  ordenes.aprobar(o.id, datos(o));
  salidas.length = 0;
  assert.equal(ordenes.editar(o.id, { ...datos(o, [{ cantidad: '3', unidad: 'pz', material: 'MALLA' }]), estado: 'surtida' }), true);
  assert.equal(ordenes.obtener(o.id).estado, 'surtida');
  assert.equal(ordenes.obtener(o.id).renglones[0].cantidad, '3');
  assert.equal(salidas.length, 0);
  assert.throws(() => ordenes.editar(o.id, { ...datos(o), estado: 'por_aprobar' }), /Estatus inválido/);
});

test('en el pizarrón la orden va y regresa entre columnas sin avisar ni perder datos', async () => {
  const tel = persona();
  await solicitudes.procesarMensaje(mensaje(tel, `${AVISO}\n1 pz malla`));
  const o = ultimaDe(tel);
  assert.equal(ordenes.mover(o.id, 'surtida'), false); // todavía por aprobar
  ordenes.aprobar(o.id, datos(o));
  ordenes.editar(o.id, { ...datos(o), estado: 'aprobada', nota: ' urgente ' });
  salidas.length = 0;
  for (const estado of ['surtida', 'aprobada', 'cancelada', 'aprobada', 'surtida', 'cancelada', 'surtida']) {
    assert.equal(ordenes.mover(o.id, estado), true);
    assert.equal(ordenes.obtener(o.id).estado, estado);
  }
  const movida = ordenes.obtener(o.id);
  assert.equal(movida.nota, 'urgente');
  assert.deepEqual(movida.renglones, o.renglones);
  assert.equal(salidas.length, 0);
  assert.throws(() => ordenes.mover(o.id, 'por_aprobar'), /Estatus inválido/);
  ordenes.editar(o.id, { ...datos(movida), estado: 'surtida', nota: '' });
  assert.equal(ordenes.obtener(o.id).nota, null);
});

test('eliminar: sólo desde Canceladas; la saca del pizarrón y no contesta', async () => {
  const tel = persona();
  await solicitudes.procesarMensaje(mensaje(tel, `${AVISO}\n1 pz malla`));
  const o = ultimaDe(tel);
  ordenes.aprobar(o.id, datos(o));
  salidas.length = 0;
  assert.equal(ordenes.eliminar(o.id), false); // aprobada: no
  ordenes.mover(o.id, 'cancelada');
  assert.equal(ordenes.eliminar(o.id), true);
  assert.equal(ordenes.eliminar(o.id), false);
  assert.equal(ordenes.listar().some((x) => x.id === o.id), false);
  assert.equal(ordenes.mover(o.id, 'aprobada'), false); // ya no vuelve al pizarrón
  assert.equal(salidas.length, 0);
});

test('descartar saca la orden de la lista y no contesta', async () => {
  const tel = persona();
  await solicitudes.procesarMensaje(mensaje(tel, `${AVISO}\n1 pz malla`));
  const o = ultimaDe(tel);
  salidas.length = 0;
  assert.equal(ordenes.descartar(o.id), true);
  assert.equal(ordenes.descartar(o.id), false);
  assert.equal(deTel(tel).length, 0);
  assert.equal(salidas.length, 0);
});

test('entradas de almacén: folio obligatorio y ningún renglón a medias', () => {
  const bien = [{ cantidad: '1', material: 'cal' }];
  assert.throws(() => ordenes.registrarEntrada({ renglones: bien }), /Falta el folio/);
  assert.throws(() => ordenes.registrarEntrada({ folio: 'F1', renglones: [] }), /al menos un material/);
  assert.throws(() => ordenes.registrarEntrada({ folio: 'F1', renglones: [...bien, { cantidad: '5', unidad: 'pz' }] }), /Falta el material del renglón "5 pz"/);
  assert.throws(() => ordenes.registrarEntrada({ folio: 'F1', renglones: [...bien, { cantidad: '0', material: 'malla' }] }), /Falta la cantidad de MALLA/);
  assert.equal(ordenes.entradas().some((e) => e.folio === 'F1'), false);
});

test('entradas de almacén: se editan; con un dato inválido no cambia nada', () => {
  ordenes.registrarEntrada({ proveedor: 'cemex', folio: 'ed-1', renglones: [{ cantidad: '1', unidad: 'pz', material: 'malla' }] });
  const { id } = ordenes.entradas()[0];
  const renglones = [{ cantidad: '2', unidad: 'b', material: 'cal' }, { cantidad: '3', unidad: 'pz', material: 'malla' }];
  assert.equal(ordenes.editarEntrada(id, { proveedor: 'promexma', folio: 'ed-2', nota: 'corregida', renglones }), true);
  let e = ordenes.entradas().find((x) => x.id === id);
  assert.equal(e.proveedor, 'PROMEXMA');
  assert.equal(e.folio, 'ED-2');
  assert.equal(e.nota, 'corregida');
  assert.deepEqual(e.renglones, [{ cantidad: '2', unidad: 'BOLSAS', material: 'CAL' }, { cantidad: '3', unidad: 'pz', material: 'MALLA' }]);
  assert.throws(() => ordenes.editarEntrada(id, { folio: '', renglones }), /Falta el folio/);
  assert.throws(() => ordenes.editarEntrada(id, { folio: 'x', renglones: [{ cantidad: '5' }] }), /Falta el material/);
  e = ordenes.entradas().find((x) => x.id === id);
  assert.equal(e.folio, 'ED-2');
  assert.equal(e.renglones.length, 2);
  assert.equal(ordenes.editarEntrada(999999, { folio: 'x', renglones }), false);
});

test('entradas de almacén: un folio con varios artículos y las abreviaturas de las notas', () => {
  ordenes.registrarEntrada({
    proveedor: 'promexma',
    folio: 'fa-123',
    nota: 'placas ABC',
    renglones: [
      { cantidad: '1/2', unidad: 'ton', material: 'cemento' },
      { cantidad: '10', unidad: 'B', material: 'polvo' },
      { cantidad: '5', unidad: 'm3', material: 'grava cb' },
      { cantidad: '3', unidad: 'CB', material: 'arena' },
      { cantidad: '', unidad: '', material: '' },
    ],
  });
  const [e] = ordenes.entradas();
  assert.equal(e.proveedor, 'PROMEXMA');
  assert.equal(e.folio, 'FA-123');
  assert.equal(e.nota, 'placas ABC');
  assert.deepEqual(e.renglones, [
    { cantidad: '1/2', unidad: 'ton', material: 'CEMENTO' },
    { cantidad: '10', unidad: 'BOLSAS', material: 'POLVO' },
    { cantidad: '5', unidad: 'm³', material: 'GRAVA CON BOLSA' },
    { cantidad: '3', unidad: 'CON BOLSA', material: 'ARENA' },
  ]);
});
