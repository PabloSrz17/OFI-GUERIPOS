const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');
delete process.env.ANTHROPIC_API_KEY;

const db = require('../src/db/connection');
const cotizaciones = require('../src/repositories/cotizaciones.repo');
const { intencion } = require('../src/integraciones/inspector/pagos');
const { procesarMensaje } = require('../src/integraciones/inspector/solicitudes');
const { normalizar } = require('../src/lib/telefono');

test('qué cuenta como pago, confirmación o comprobante', () => {
  for (const t of ['Ya pagué', 'ya le deposité', 'Ya te hice la transferencia', 'ya mandé el comprobante', 'transferencia realizada', 'Pago hecho', 'listo, ya quedó', 'Pagado'])
    assert.equal(intencion(t), 'pagado', t);
  for (const t of ['Confirmo', 'de acuerdo', 'Va', 'sale pues'.replace(' pues', ''), 'ok va', 'Procede', 'me lo llevo'])
    assert.equal(intencion(t), 'confirmado', t);
  assert.equal(intencion('', true), 'comprobante');
  assert.equal(intencion('aquí está', true), 'comprobante');
});

test('dudas, negaciones y "transferencia" sola no cuentan', () => {
  for (const t of ['aún no pago', 'todavía no deposito', 'no puedo pagar hoy', '¿ya quedó?', 'cuánto es?', 'voy a pagar mañana',
    'te pago al rato', 'ok, ahora le confirmo', 'va, ahora te confirmo', 'Va, le confirmo', 'ahorita le deposito',
    'déjame lo checo y te aviso', 'ok, después le confirmo', 'en un rato te digo', 'transferencia', 'SPEI', 'pago con transferencia', 'aceptan tarjeta', 'hola', ''])
    assert.equal(intencion(t), null, t);
});

function mensaje(body, numero, type = 'chat') {
  const enviados = [];
  return {
    enviados, type, body, from: `${numero}@c.us`, id: { id: `${numero}-${Math.random()}` },
    timestamp: Math.floor(Date.now() / 1000),
    getContact: async () => ({ id: { user: numero } }),
    client: { sendMessage: async (_a, t) => { enviados.push(t); } },
  };
}
function cotizacionAbierta(numero) {
  const { cotizacion } = cotizaciones.aprobar({
    cliente: 'CLIENTE PAGO', telefono: normalizar(numero), colonia: 'Fovi', solicitud: null, total: 550,
    partidas: [{ tipo: 'producto', descripcion: 'GRAVA', cantidad: 1, unidad: 'm3', precio: 550, importe: 550, texto: 'grava' }],
  }, false);
  return cotizacion.id;
}
const fila = (id) => db.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(id);

test('"ya pagué" por WhatsApp marca Pagada su cotización abierta y no le contesta nada', async () => {
  const numero = '5219991110001';
  const id = cotizacionAbierta(numero);
  const m = mensaje('Ya le deposité, gracias', numero);
  await procesarMensaje(m);
  const c = fila(id);
  assert.equal(c.estado, 'pagada');
  assert.ok(c.pagada_en);
  assert.equal(c.aviso_cliente, 'pagado');
  assert.equal(c.aviso_texto, 'Ya le deposité, gracias');
  assert.equal(m.enviados.length, 0);
});

test('"confirmo" deja la cotización en espera, sólo con el aviso', async () => {
  const numero = '5219991110002';
  const id = cotizacionAbierta(numero);
  await procesarMensaje(mensaje('Confirmo', numero));
  const c = fila(id);
  assert.equal(c.estado, 'aprobada');
  assert.equal(c.aviso_cliente, 'confirmado');
});

test('una foto sin texto: comprobante por revisar', async () => {
  const numero = '5219991110003';
  const id = cotizacionAbierta(numero);
  await procesarMensaje(mensaje('', numero, 'image'));
  assert.equal(fila(id).estado, 'aprobada');
  assert.equal(fila(id).aviso_cliente, 'comprobante');
  assert.equal(fila(id).aviso_texto, '📷 Foto');
});

test('"aún no pago" no toca nada; sin cotización abierta tampoco pasa nada', async () => {
  const numero = '5219991110004';
  const id = cotizacionAbierta(numero);
  await procesarMensaje(mensaje('aún no pago, al rato', numero));
  assert.equal(fila(id).estado, 'aprobada');
  assert.equal(fila(id).aviso_cliente, null);
  await procesarMensaje(mensaje('ya pagué', '5219991110099')); // nadie le cotizó
});
