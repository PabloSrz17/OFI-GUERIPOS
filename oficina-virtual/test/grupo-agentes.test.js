const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. La IA es falsa: no se gasta ni sale nada.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');
process.env.ANTHROPIC_API_KEY = 'prueba';
const llamadas = [];
let carga = null;
let cotizacion = null;
let ordenIA = null;
class IAFalsa {
  constructor() {
    this.messages = {
      create: async (p) => {
        const props = p.output_config?.format?.schema?.properties ?? {};
        const json = props.es_carga ? carga : props.es_cotizacion || props.es_pedido ? cotizacion : props.renglones && props.sucursal ? ordenIA : null;
        llamadas.push(props.es_carga ? 'carga' : props.es_cotizacion ? 'cotizacion' : 'pregunta');
        const texto = json ? JSON.stringify(json) : 'Respuesta del agente';
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: texto }] };
      },
    };
  }
}
const sdk = require.resolve('@anthropic-ai/sdk');
require.cache[sdk] = { id: sdk, filename: sdk, loaded: true, exports: IAFalsa };

const db = require('../src/db/connection');
const grupo = require('../src/integraciones/agentes/grupo');
const solicitudes = require('../src/integraciones/inspector/solicitudes');

const GRUPO = '120363000000000001@g.us';
function mensaje(body, { from = GRUPO, nombreGrupo = 'Agentes IA Chat', extra = {} } = {}) {
  const m = {
    type: 'chat',
    from,
    body,
    timestamp: Math.floor(Date.now() / 1000),
    respuestas: [],
    getChat: async () => ({ name: nombreGrupo }),
    getContact: async () => ({ pushname: 'Moisés' }),
    client: { sendMessage: async (a, t, o) => { m.respuestas.push(o?.caption ? `[foto] ${o.caption}` : t); } },
    ...extra,
  };
  return m;
}
async function enviar(body, opciones) {
  const m = mensaje(body, opciones);
  await grupo.procesarMensaje(m);
  return m.respuestas;
}
const cargas = () => db.prepare('SELECT unidad, importe, concepto, litros, reporto FROM combustible ORDER BY id').all();

test('contesta sólo el agente nombrado primero; sin nombre no contesta nadie', () => {
  assert.equal(grupo.agenteDe('Edgar, la nissan blanca echó 500 de gas'), 'rutas');
  assert.equal(grupo.agenteDe('oye CHATITO y Edgar'), 'inspector');
  assert.equal(grupo.agenteDe('Sulema, ¿entró la N900?'), 'chasis');
  assert.equal(grupo.agenteDe('max, ¿qué órdenes hay?'), 'octavio');
  assert.equal(grupo.agenteDe('a lo máx 3 días'), null);
  assert.equal(grupo.agenteDe('Edgarito ya llegó'), null);
  assert.equal(grupo.agenteDe('buenos días'), null);
});

test('sólo el grupo AGENTES IA CHAT: otros grupos y chats privados no reciben respuesta', async () => {
  llamadas.length = 0;
  assert.deepEqual(await enviar('Edgar, ¿cuántas notas hay?', { from: '120363000000000002@g.us', nombreGrupo: 'Familia' }), []);
  assert.deepEqual(await enviar('Edgar, ¿cuántas notas hay?', { from: '5219810000000@c.us' }), []);
  assert.deepEqual(await enviar('buenos días a todos'), []);
  assert.deepEqual(await enviar('Edgar, ¿cuántas notas hay?', { extra: { timestamp: Math.floor(Date.now() / 1000) - 600 } }), []);
  assert.deepEqual(llamadas, []);
});

test('Edgar anota la carga de combustible y contesta sólo "Enterado ✅"', async () => {
  carga = { es_carga: true, unidad: 'Nissan blanca', importe: 500, concepto: 'gasolina', litros: 0 };
  assert.deepEqual(await enviar('Edgar, la nissan blanca echó 500 de gas'), ['Enterado ✅']);
  assert.deepEqual(cargas().at(-1), { unidad: 'NISSAN BLANCA', importe: 500, concepto: 'gasolina', litros: null, reporto: 'Moisés' });
});

test('en chat privado, "Edgar ... gasolina" también se anota y contesta "Enterado ✅"', async () => {
  carga = { es_carga: true, unidad: 'estaquitas', importe: 500, concepto: 'gasolina', litros: 0 };
  const m = mensaje('Edgar, la estaquitas echó 500 de gasolina', { from: '5219810000001@c.us' });
  await solicitudes.procesarMensaje(m);
  assert.deepEqual(m.respuestas, ['Enterado ✅']);
  assert.deepEqual(cargas().at(-1), { unidad: 'ESTAQUITAS', importe: 500, concepto: 'gasolina', litros: null, reporto: 'Moisés' });
});

test('si a la carga le falta el importe, no anota y dice cómo escribirlo', async () => {
  const antes = cargas().length;
  carga = { es_carga: true, unidad: 'Ram', importe: 0, concepto: 'diesel', litros: 0 };
  const [r] = await enviar('Edgar, la ram cargó diésel');
  assert.match(r, /No entendí/);
  assert.equal(cargas().length, antes);
});

test('una pregunta de Edgar sobre gasolina la contesta él, sin anotar nada', async () => {
  const antes = cargas().length;
  carga = { es_carga: false, unidad: '', importe: 0, concepto: 'gasolina', litros: 0 };
  llamadas.length = 0;
  assert.deepEqual(await enviar('Edgar, ¿cuánta gasolina llevamos esta semana?'), ['Respuesta del agente']);
  assert.deepEqual(llamadas, ['carga', 'pregunta']);
  assert.equal(cargas().length, antes);
});

test('Chatito deja la cotización por autorizar en la Oficina y no le manda nada al cliente', async () => {
  cotizacion = { es_cotizacion: true, nombre_cliente: 'Juan Pérez', colonia: 'Fovi', metodo_pago: '', productos: [{ cantidad: 5, unidad: 'm³', producto: 'grava' }] };
  const [r] = await enviar('Chatito, hazme una cotización formal en PDF para Juan Pérez: 5 m3 grava en Fovi');
  assert.match(r, /por autorizar.*JUAN PÉREZ, 1 material/);
  const tarjeta = solicitudes.pendientes().find((s) => s.nombre === 'JUAN PÉREZ');
  assert.ok(tarjeta);
  assert.equal(tarjeta.telefono, null);
});

test('las demás preguntas van al agente nombrado y la respuesta sale en el grupo', async () => {
  llamadas.length = 0;
  assert.deepEqual(await enviar('Sulema y Edgar, ¿cuántas notas entraron hoy?'), ['Respuesta del agente']);
  assert.deepEqual(llamadas, ['pregunta']);
  assert.equal(db.prepare(`SELECT texto FROM agentes_chat WHERE agente = 'chasis' AND de = 'tu' ORDER BY id DESC`).get().texto,
    'Moisés en el grupo: Sulema y Edgar, ¿cuántas notas entraron hoy?');
});

test('si getChat falla (error "r" de la librería), el nombre del grupo se lee en la página', async () => {
  const m = mensaje('Edgar, ¿cuántas notas hay?', { from: '120363000000000003@g.us' });
  m.getChat = async () => { throw new Error('r'); };
  m.client.pupPage = { evaluate: async () => 'AGENTES IA CHAT' };
  await grupo.procesarMensaje(m);
  assert.deepEqual(m.respuestas, ['Respuesta del agente']);
});

test('foto al grupo con "Chatito": contesta al momento y deja la tarjeta por autorizar', async () => {
  cotizacion = { es_cotizacion: true, es_pedido: true, nombre_cliente: '', colonia: '', metodo_pago: '', productos: [{ cantidad: 3, unidad: 'bulto', producto: 'cemento' }] };
  const bus = require('../src/events/bus');
  const avisos = [];
  const oir = (id) => avisos.push(id);
  bus.on('solicitud:foto', oir);
  const m = mensaje('Chatito cotiza esto', { from: '120363000000000004@g.us', extra: { type: 'image', id: { id: 'x' } } });
  m.client.pupPage = { evaluate: async (fn, arg) => (arg === 'x' ? { mimetype: 'image/jpeg', data: 'AAAA' } : null) };
  await grupo.procesarMensaje(m);
  bus.off('solicitud:foto', oir);
  assert.deepEqual(m.respuestas, [grupo.FOTO_RECIBIDA]);
  assert.equal(avisos.length, 1);
  const tarjeta = solicitudes.obtener(avisos[0]);
  assert.equal(tarjeta.nombre, 'COTIZACIÓN DEL GRUPO');
  assert.match(tarjeta.borrador, /cemento/i);
});

test('Max en el grupo: imagen con "¿Así está bien?", corrige hasta el sí y la deja en su pestaña', async () => {
  const octavio = require('../src/integraciones/octavio/grupo');
  const dibujadas = [];
  octavio.config.dibujar = async (o) => { dibujadas.push(o); return Buffer.from('png'); };
  const ordenes = require('../src/integraciones/octavio/ordenes');
  const antes = ordenes.listar().length;

  assert.ok(!octavio.esPedido('Max, ¿qué órdenes hay?'));
  assert.ok(octavio.esPedido('Max mándame este material para almacén'));
  ordenIA = { sucursal: 'Almacén', renglones: [{ cantidad: '10', unidad: 'bultos', material: 'CEMENTO MAYA' }] };
  assert.deepEqual(await enviar('Max mándame este material para almacén:\n10 bultos cemento maya'), ['[foto] ¿Así está bien?']);
  assert.equal(dibujadas.at(-1).sucursal, 'Almacén');
  assert.equal(dibujadas.at(-1).etiqueta, 'VISTA PREVIA · POR CONFIRMAR');

  assert.deepEqual(await enviar('No'), ['¿Qué le cambio?']);
  ordenIA = { sucursal: 'Almacén', renglones: [{ cantidad: '15', unidad: 'bultos', material: 'CEMENTO MAYA' }, { cantidad: '5', unidad: 'm³', material: 'GRAVA' }] };
  assert.deepEqual(await enviar('son 15 y agrégale 5 m3 de grava'), ['[foto] ¿Así está bien?']);
  assert.equal(dibujadas.at(-1).renglones.length, 2);

  assert.equal(ordenes.listar().length, antes); // nada guardado hasta el sí
  assert.deepEqual(await enviar('Sí'), ['Oki ✅']);
  const o = ordenes.listar()[0];
  assert.equal(o.sucursal, 'Almacén');
  assert.equal(o.estado, 'aprobada');
  assert.equal(o.solicitante, 'MOISÉS');
  assert.deepEqual(o.renglones.map((r) => r.cantidad), ['15', '5']);
  // Ya cerrada: un "sí" suelto no es para Max.
  assert.deepEqual(await enviar('sí'), []);

  // Concordia por "orden de compra"; "cancela" la descarta sin guardar.
  ordenIA = { sucursal: 'Concordia', renglones: [{ cantidad: '2', unidad: 'pzas', material: 'VARILLA' }] };
  assert.deepEqual(await enviar('Max orden de compra para Concordia: 2 varillas'), ['[foto] ¿Así está bien?']);
  assert.equal(dibujadas.at(-1).sucursal, 'Concordia');
  assert.deepEqual(await enviar('cancela'), ['Va, la descarté.']);
  assert.equal(ordenes.listar().length, antes + 1);
});

test('Edgar pregunta si registra el retiro en la Caja de Pulpos y sólo lo hace con "sí"', async () => {
  const combustible = require('../src/integraciones/agentes/combustible');
  const registrados = [];
  const original = { ...combustible.pulpos };
  combustible.pulpos.activo = () => true;
  combustible.pulpos.registrar = async (retiro) => { registrados.push(retiro); return 'id-falso'; };
  try {
    carga = { es_carga: true, unidad: 'Nissan roja', importe: 300, concepto: 'gasolina', litros: 0 };
    const [pregunta] = await enviar('Edgar, la nissan roja echó 300 de gas');
    assert.match(pregunta, /^Enterado ✅\n¿Lo registro como retiro en la Caja de PS\? \(\$300 · gas nissan roja \(Edgar\)\)/);
    assert.deepEqual(registrados, []); // sin "sí" no se toca Pulpos

    assert.deepEqual(await enviar('Sí'), ['Listo ✅ quedó el retiro en la Caja de PS: $300 · gas nissan roja (Edgar)']);
    assert.deepEqual(registrados, [{ importe: 300, motivo: 'gas nissan roja (Edgar)' }]);
    assert.deepEqual(await enviar('sí'), []); // un segundo "sí" no registra otro

    carga = { es_carga: true, unidad: 'Torton', importe: 1000, concepto: 'diesel', litros: 0 };
    await enviar('Edgar, el torton echó 1000 de diesel');
    assert.deepEqual(await enviar('no'), ['Ok, no lo registro en PS.']);
    assert.equal(registrados.length, 1);

    // Si Pulpos falla, lo dice y pide registrarlo a mano.
    combustible.pulpos.registrar = async () => { throw new Error('la sesión de Pulpos está cerrada'); };
    carga = { es_carga: true, unidad: 'RAM', importe: 450, concepto: 'diesel', litros: 0 };
    await enviar('Edgar, la ram echó 450 de diesel');
    const [fallo] = await enviar('si');
    assert.match(fallo, /^No pude registrarlo en PS \(la sesión de Pulpos está cerrada\)\. Regístralo a mano/);
  } finally {
    Object.assign(combustible.pulpos, original);
  }
});

test('escrito desde el WhatsApp de la Oficina: Edgar contesta igual y nunca se contesta a sí mismo', async () => {
  const combustible = require('../src/integraciones/agentes/combustible');
  const registrados = [];
  const original = { ...combustible.pulpos };
  combustible.pulpos.activo = () => true;
  combustible.pulpos.registrar = async (retiro) => { registrados.push(retiro); };
  const CHAT = '5219811111111@c.us';
  const propio = async (body) => {
    const m = mensaje(body, { extra: { fromMe: true, to: CHAT } });
    await grupo.procesarPropio(m);
    return m.respuestas;
  };
  try {
    carga = { es_carga: true, unidad: 'Nissan roja', importe: 500, concepto: 'gasolina', litros: 0 };
    const [pregunta] = await propio('edgar se echó $500 gasolina nissan roja');
    assert.match(pregunta, /^Enterado ✅\n¿Lo registro como retiro en la Caja de PS\?/);
    assert.equal(cargas().at(-1).reporto, 'Oficina (WhatsApp)');
    // Lo que manda Edgar también llega como "propio": no se contesta.
    assert.deepEqual(await propio(pregunta), []);
    assert.deepEqual(await propio('Sí'), ['Listo ✅ quedó el retiro en la Caja de PS: $500 · gas nissan roja (Edgar)']);
    assert.deepEqual(await propio('Listo ✅ quedó el retiro en la Caja de PS: $500 · gas nissan roja (Edgar)'), []);
    assert.deepEqual(await propio('ok gracias'), []); // ya no hay pregunta pendiente
    assert.equal(registrados.length, 1);
    // Mensajes normales desde la Oficina no los toca.
    assert.deepEqual(await propio('Buenas tardes, su pedido va en camino'), []);
  } finally {
    Object.assign(combustible.pulpos, original);
  }
});
