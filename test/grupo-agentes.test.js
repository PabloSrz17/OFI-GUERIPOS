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
class IAFalsa {
  constructor() {
    this.messages = {
      create: async (p) => {
        const props = p.output_config?.format?.schema?.properties ?? {};
        const json = props.es_carga ? carga : props.es_cotizacion ? cotizacion : null;
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
    client: { sendMessage: async (a, t) => { m.respuestas.push(t); } },
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
  assert.equal(grupo.agenteDe('octavio, ¿qué órdenes hay?'), 'octavio');
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
