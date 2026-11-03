const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. Debe ir antes de cargar los módulos.
const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-'));
process.env.DB_PATH = path.join(carpeta, 'prueba.sqlite');
delete process.env.ANTHROPIC_API_KEY; // la bienvenida no debe depender de la IA

const db = require('../src/db/connection');
const cotizaciones = require('../src/repositories/cotizaciones.repo');
const seguimiento = require('../src/integraciones/inspector/seguimiento');
const solicitudes = require('../src/integraciones/inspector/solicitudes');
const { bienvenida, seguimiento: textoSeguimiento } = require('../src/integraciones/whatsapp/mensajes');

function cotizacionEnviada(telefono) {
  const { cotizacion } = cotizaciones.aprobar({
    cliente: 'CLIENTE', telefono, colonia: 'Fovi', solicitud: null, total: 550,
    partidas: [{ tipo: 'producto', descripcion: 'Grava', cantidad: 1, unidad: 'm³', precio: 550, importe: 550, texto: 'grava' }],
  }, false);
  cotizaciones.marcarWhatsapp(cotizacion.id, 'enviado');
  return cotizacion.id;
}
const vencer = (id) => db.prepare(`UPDATE cotizaciones SET seguimiento_para = datetime('now', 'localtime', '-1 minute') WHERE id = ?`).run(id);
const fila = (id) => db.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(id);
const clienteFalso = () => {
  const enviados = [];
  return { enviados, estaListo: () => true, enviar: async (tel, texto) => { enviados.push([tel, texto]); return true; } };
};

test('al enviar se programa el recordatorio exactamente 24 horas después', () => {
  const c = fila(cotizacionEnviada('529810000001'));
  assert.equal(c.seguimiento_estado, 'pendiente');
  assert.equal((new Date(c.seguimiento_para) - new Date(c.enviada_en)) / 3_600_000, 24);
});

test('antes de 24 horas no sale; al cumplirse sale una sola vez', async () => {
  const id = cotizacionEnviada('529810000002');
  const cliente = clienteFalso();
  await seguimiento.revisar(cliente);
  assert.equal(cliente.enviados.length, 0);
  vencer(id);
  await seguimiento.revisar(cliente);
  await seguimiento.revisar(cliente);
  assert.deepEqual(cliente.enviados, [['529810000002', textoSeguimiento()]]);
  assert.equal(fila(id).seguimiento_estado, 'enviado');
});

test('Pagada o Cerrada cancelan el recordatorio; deshacer lo reactiva', async () => {
  const pagada = cotizacionEnviada('529810000003');
  const cerrada = cotizacionEnviada('529810000004');
  cotizaciones.marcarEstado(pagada, 'pagada');
  cotizaciones.marcarEstado(cerrada, 'cerrada');
  vencer(pagada);
  vencer(cerrada);
  const cliente = clienteFalso();
  await seguimiento.revisar(cliente);
  assert.equal(cliente.enviados.length, 0);
  assert.ok(fila(pagada).pagada_en);
  assert.equal(fila(pagada).seguimiento_estado, 'cancelado');

  cotizaciones.marcarEstado(pagada, 'aprobada');
  assert.equal(fila(pagada).pagada_en, null);
  await seguimiento.revisar(cliente);
  assert.equal(cliente.enviados.length, 1);
});

test('sin conexión a WhatsApp espera, no se pierde', async () => {
  const id = cotizacionEnviada('529810000005');
  vencer(id);
  await seguimiento.revisar({ estaListo: () => false });
  assert.equal(fila(id).seguimiento_estado, 'pendiente');
  db.prepare(`UPDATE cotizaciones SET estado = 'cerrada' WHERE id = ?`).run(id);
});

test('la bienvenida depende de la hora y nunca lleva precios', () => {
  assert.match(bienvenida(new Date(2026, 9, 30, 9)), /^¡Hola, buenos días!/);
  assert.match(bienvenida(new Date(2026, 9, 30, 15)), /^¡Hola, buenas tardes!/);
  assert.match(bienvenida(new Date(2026, 9, 30, 20)), /^¡Hola, buenas noches!/);
  assert.doesNotMatch(bienvenida(), /\$/);
});

test('el recordatorio saluda según la hora en que sale (nunca "buenas tardes" a las 8:50)', () => {
  const a = (h, m) => textoSeguimiento(new Date(2026, 10, 3, h, m));
  assert.match(a(0, 0), /^Buenos días, ¿qué le pareció/);
  assert.match(a(8, 50), /^Buenos días,/);
  assert.match(a(11, 59), /^Buenos días,/);
  assert.match(a(12, 0), /^Buenas tardes,/);
  assert.match(a(18, 59), /^Buenas tardes,/);
  assert.match(a(19, 0), /^Buenas noches,/);
  assert.match(a(23, 59), /^Buenas noches,/);
});

const mensaje = (numero, body) => {
  const enviados = [];
  return {
    enviados, fromMe: false, type: 'chat', from: `${numero}@c.us`, body,
    getContact: async () => ({ number: numero }),
    client: { sendMessage: async (_chat, t) => enviados.push(t) },
  };
};

test('en chats @lid toma el teléfono real del contacto', async () => {
  const m = mensaje('271875000000001', 'Hola, necesito material');
  m.from = '271875000000001@lid';
  m.getContact = async () => ({ number: '271875000000001', id: { user: '5219810000020' } });
  await solicitudes.procesarMensaje(m);
  assert.equal(m.enviados.length, 1);
  assert.ok(db.prepare('SELECT 1 FROM conversaciones_whatsapp WHERE clave = ?').get('529810000020'));
});

test('bienvenida automática una sola vez, y no a quien contesta una cotización', async () => {
  const primero = mensaje('5219810000006', 'Hola, ocupo una cotización');
  await solicitudes.procesarMensaje(primero);
  assert.equal(primero.enviados.length, 1);
  const segundo = mensaje('5219810000006', 'otra cotización, me oyen?');
  await solicitudes.procesarMensaje(segundo);
  assert.equal(segundo.enviados.length, 0);

  cotizacionEnviada('529810000007');
  const responde = mensaje('5219810000007', 'gracias, luego les pido otra cotización');
  await solicitudes.procesarMensaje(responde);
  assert.equal(responde.enviados.length, 0);
});

test('editar a mano: cambia renglones y total, agrega partidas y conserva folio y cliente', () => {
  const { calcular } = require('../src/integraciones/inspector/cotizador');
  const id = cotizacionEnviada('529810000009');
  const antes = cotizaciones.obtener(id);
  const editada = cotizaciones.editar(id, calcular([
    { tipo: 'producto', descripcion: 'Grava', cantidad: '2', unidad: 'm³', precio: 600 },
    { tipo: 'producto', descripcion: 'Cemento Maya', cantidad: '10', unidad: 'bulto', precio: 150 },
    { tipo: 'flete', descripcion: 'Flete a Fovi', cantidad: '1', unidad: 'viaje', precio: 300 },
  ]));
  assert.equal(editada.folio, antes.folio);
  assert.equal(editada.cliente, 'CLIENTE');
  assert.equal(editada.total, 1200 + 1500 + 300);
  assert.deepEqual(editada.partidas.map((p) => [p.descripcion, p.importe]), [['Grava', 1200], ['Cemento Maya', 1500], ['Flete a Fovi', 300]]);
  assert.equal(cotizaciones.editar(999999, calcular([{ descripcion: 'X', cantidad: 1, unidad: 'pz', precio: 1 }])), null);
});
