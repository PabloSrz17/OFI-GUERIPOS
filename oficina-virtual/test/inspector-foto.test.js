const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. Sin clave de IA: no se gasta ni sale nada.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');
delete process.env.ANTHROPIC_API_KEY;

const { aNumero, calcular } = require('../src/integraciones/inspector/cotizador');
const solicitudes = require('../src/integraciones/inspector/solicitudes');

test('las fracciones se convierten para calcular el importe', () => {
  assert.equal(aNumero('1/2'), 0.5);
  assert.equal(aNumero('1 1/2'), 1.5);
  assert.equal(aNumero('7'), 7);
  assert.equal(aNumero('1,5'), 1.5);
  assert.ok(Number.isNaN(aNumero('1/0')));
  assert.ok(Number.isNaN(aNumero('')));
  assert.ok(Number.isNaN(aNumero('media')));
  const r = calcular([{ descripcion: 'Grava', cantidad: '1/2', precio: 550 }]);
  assert.equal(r.total, 275);
  assert.throws(() => calcular([{ descripcion: 'Grava', cantidad: 'media', precio: 550 }]), /Cantidad inválida/);
});

test('sin clave de IA una foto no se descarga ni se contesta', async () => {
  let descargas = 0;
  let enviados = 0;
  await solicitudes.procesarMensaje({
    type: 'image',
    from: '5219810000000@c.us',
    body: '',
    timestamp: Math.floor(Date.now() / 1000),
    getContact: async () => ({ id: { user: '5219810000000' } }),
    downloadMedia: async () => { descargas += 1; },
    client: { sendMessage: async () => { enviados += 1; } },
  });
  assert.equal(descargas, 0);
  assert.equal(enviados, 0);
  assert.equal(solicitudes.pendientes().length, 0);
});

test('la foto se busca por id.id, porque id._serialized llega vacío en vivo', async () => {
  const { bajarImagen } = require('../src/integraciones/whatsapp/medios');
  const foto = { mimetype: 'image/jpeg', data: 'AAAA' };
  let idPedido = null;
  const pagina = { evaluate: async (_fn, id) => { idPedido = id; return foto; } };
  assert.equal(await bajarImagen({ id: { id: 'ABC', fromMe: false }, client: { pupPage: pagina } }), foto);
  assert.equal(idPedido, 'ABC');
});

test('un sticker o un audio se ignoran', async () => {
  for (const type of ['sticker', 'ptt', 'video']) {
    await solicitudes.procesarMensaje({ type, from: '5219810000000@c.us', body: '', timestamp: Math.floor(Date.now() / 1000) });
  }
  assert.equal(solicitudes.pendientes().length, 0);
});

test('Tesseract: sólo vale si todos los renglones con cantidad se entienden y están en la lista', () => {
  const { productosDeTexto } = require('../src/integraciones/inspector/ocr');
  const catalogo = [{ claves: 'grava', nombre: 'Grava', unidad: 'm³', precio: 550 }, { claves: 'cemento maya', nombre: 'Cemento Maya', unidad: 'bulto', precio: 150 }];
  assert.deepEqual(productosDeTexto('Lista\n3 m3 grava\n10 bultos cemento maya', catalogo).map((p) => [p.cantidad, p.producto]),
    [['3', 'GRAVA'], ['10', 'CEMENTO MAYA']]);
  assert.equal(productosDeTexto('3 m3 grava\n10 bultos chicle', catalogo), null); // no está en la lista
  assert.equal(productosDeTexto('3 m3 grava\nHhhks de (o 4 ad', catalogo), null); // renglón ilegible
  assert.equal(productosDeTexto('hola buenas tardes', catalogo), null);
});

test('tarjeta con productos de foto: el grupo recibe su imagen pidiendo autorización (sin enviar al cliente)', async () => {
  const grupo = require('../src/integraciones/agentes/grupo');
  const db = require('../src/db/connection');
  const borrador = { cliente: 'JUAN', colonia: 'Fovi', metodo_pago: 'efectivo', partidas: [
    { tipo: 'producto', descripcion: 'Grava', cantidad: '2', unidad: 'm³', precio: 550 },
    { tipo: 'producto', descripcion: 'Chicle', cantidad: '1', unidad: '', precio: null },
    { tipo: 'flete', descripcion: 'Flete a Fovi', cantidad: 1, unidad: 'viaje', precio: null }] };
  const id = db.prepare('INSERT INTO solicitudes_whatsapp (telefono, nombre, mensaje, borrador) VALUES (?, ?, ?, ?)')
    .run('529810000099', 'JUAN', '[Foto]', JSON.stringify(borrador)).lastInsertRowid;
  const enviados = [];
  const whatsapp = { estaListo: () => true, enviarImagenAGrupo: async (...a) => { enviados.push(a); return true; } };
  await grupo.avisarTarjeta(whatsapp, id);
  assert.equal(enviados.length, 1);
  const [nombreGrupo, png, , pie] = enviados[0];
  assert.ok(nombreGrupo);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(pie, 'Así quedó la cotización en la Oficina. ¿Me autorizas enviarla?');
});
