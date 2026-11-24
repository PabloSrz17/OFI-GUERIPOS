const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. La IA es falsa: no se gasta ni sale nada.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');
process.env.ANTHROPIC_API_KEY = 'prueba';
let folioLeido = '';
let lecturas = 0;
class IAFalsa {
  constructor() {
    this.messages = {
      create: async () => {
        lecturas += 1;
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ folio: folioLeido }) }] };
      },
    };
  }
}
const sdk = require.resolve('@anthropic-ai/sdk');
require.cache[sdk] = { id: sdk, filename: sdk, loaded: true, exports: IAFalsa };

const db = require('../src/db/connection');
const evidencias = require('../src/integraciones/sulema/evidencias');
const paquetes = require('../src/integraciones/sulema/paquetes');
const solicitudes = require('../src/integraciones/inspector/solicitudes');
const grupo = require('../src/integraciones/agentes/grupo');
const reporte = require('../src/repositories/reporte.repo');

const cliente = db.prepare("INSERT INTO clientes (nombre) VALUES ('JUAN PÉREZ')").run().lastInsertRowid;
const chofer = db.prepare("INSERT INTO choferes (nombre) VALUES ('Darío')").run().lastInsertRowid;
const camion = db.prepare("INSERT INTO camiones (nombre) VALUES ('Ram 4000')").run().lastInsertRowid;
function nota(folio, estado = 'en_ruta') {
  return db.prepare(`INSERT INTO notas (folio, cliente_id, material, cantidad, direccion, estado, chofer_id, camion_id)
    VALUES (?, ?, 'GRAVA', 2, 'CENTRO', ?, ?, ?)`).run(folio, cliente, estado, chofer, camion).lastInsertRowid;
}
const estadoDe = (id) => db.prepare('SELECT estado FROM notas WHERE id = ?').get(id).estado;
const fotosDe = (id) => db.prepare('SELECT * FROM evidencias WHERE nota_id = ?').all(id);

let tel = 5219810000300;
const ahora = () => Math.floor(Date.now() / 1000);
function mensaje({ from, body = '', foto = false, timestamp = ahora(), author, nombreGrupo }) {
  const m = {
    type: foto ? 'image' : 'chat',
    from,
    author,
    body,
    timestamp,
    id: { id: `M${Math.random()}` },
    respuestas: [],
    getContact: async () => ({ id: { user: from.split('@')[0] }, pushname: 'Darío' }),
    getChat: async () => ({ name: nombreGrupo }),
    client: {
      pupPage: { evaluate: async () => ({ mimetype: 'image/jpeg; codecs', data: Buffer.from('foto').toString('base64') }) },
      sendMessage: async (a, t) => { m.respuestas.push(t); },
    },
  };
  return m;
}
const privado = () => `${(tel += 1)}@c.us`;

test('folios del texto: primero el que va después de "nota"', () => {
  assert.deepEqual(evidencias.foliosEn('Sulema, 120 bultos de la nota 33249'), ['33249', '120']);
  assert.deepEqual(evidencias.foliosEn('sulema nota n975'), ['N975']);
  assert.deepEqual(evidencias.foliosEn('Sulema nota folio: 272-S1'), ['272-S1']);
});

test('foto con "Sulema nota 33249": guarda la foto por mes y la nota en ruta queda entregada', async () => {
  const id = nota('33249');
  const m = mensaje({ from: privado(), body: 'Sulema nota 33249', foto: true });
  await solicitudes.procesarMensaje(m);
  assert.deepEqual(m.respuestas, ['✅ Nota 33249 de JUAN PÉREZ: entregada con evidencia.']);
  assert.equal(estadoDe(id), 'entregado');
  const [e] = fotosDe(id);
  assert.match(e.archivo, /^\d{4}-\d{2}_[A-Z][a-z]+\/33249_\d{6}_\w{6}\.jpg$/);
  assert.equal(fs.readFileSync(path.join(evidencias.CARPETA, e.archivo), 'utf8'), 'foto');
  assert.equal(e.envio, 'Darío');
});

test('la foto y las palabras pueden llegar separadas dentro de 5 minutos; después de eso no', async () => {
  const id = nota('N975');
  const de = privado();
  const foto = mensaje({ from: de, foto: true, timestamp: ahora() - 120 });
  await evidencias.recibir(foto, { clave: de, texto: '', esFoto: true, envio: 'Darío' });
  const texto = mensaje({ from: de, body: 'sulema, ya quedó la nota N975' });
  assert.equal(await evidencias.recibir(texto, { clave: de, texto: texto.body, esFoto: false, envio: 'Darío' }), true);
  assert.equal(estadoDe(id), 'entregado');

  const otro = nota('N976');
  const tarde = privado();
  await evidencias.recibir(mensaje({ from: tarde, foto: true, timestamp: ahora() - 400 }), { clave: tarde, texto: '', esFoto: true });
  const t = mensaje({ from: tarde, body: 'Sulema nota N976' });
  assert.equal(await evidencias.recibir(t, { clave: tarde, texto: t.body, esFoto: false }), false);
  assert.equal(fotosDe(otro).length, 0);
});

test('si el folio no existe pregunta, y con el folio correcto guarda la misma foto', async () => {
  const id = nota('33300');
  const de = privado();
  const m = mensaje({ from: de, body: 'Sulema nota 99999', foto: true });
  await solicitudes.procesarMensaje(m);
  assert.match(m.respuestas[0], /No encontré ninguna nota con folio 99999/);
  const otro = mensaje({ from: de, body: 'Sulema perdón, nota 33300' });
  await solicitudes.procesarMensaje(otro);
  assert.match(otro.respuestas[0], /Nota 33300 .*entregada con evidencia/);
  assert.equal(fotosDe(id).length, 1);
});

test('sin folio escrito lo lee de la foto con la IA', async () => {
  const id = nota('44100');
  folioLeido = '44100';
  lecturas = 0;
  const m = mensaje({ from: privado(), body: 'Sulema aquí va la nota firmada', foto: true });
  await solicitudes.procesarMensaje(m);
  assert.equal(lecturas, 1);
  assert.match(m.respuestas[0], /44100/);
  assert.equal(fotosDe(id).length, 1);
});

test('una nota que no ha salido guarda la foto pero no se brinca pasos', async () => {
  const id = nota('55100', 'pendiente');
  const m = mensaje({ from: privado(), body: 'Sulema nota 55100', foto: true });
  await solicitudes.procesarMensaje(m);
  assert.match(m.respuestas[0], /sigue en Pendiente/);
  assert.equal(estadoDe(id), 'pendiente');
  assert.equal(fotosDe(id).length, 1);
});

test('también desde el grupo AGENTES IA CHAT, por persona', async () => {
  const id = nota('66100');
  const g = '120363000000000009@g.us';
  const m = mensaje({ from: g, author: '5219811111111@c.us', body: 'Sulema nota 66100', foto: true, nombreGrupo: 'AGENTES IA CHAT' });
  await grupo.procesarMensaje(m);
  assert.match(m.respuestas[0], /66100/);
  assert.equal(estadoDe(id), 'entregado');
  assert.ok(evidencias.buscar({ folio: '661' }).some((e) => e.nota_id === id));
});

test('regla de 6 meses: los meses viejos se empaquetan en .zip por año y la carpeta se borra', async () => {
  const viejo = path.join(evidencias.CARPETA, '2026-04_Abril');
  const reciente = path.join(evidencias.CARPETA, '2026-05_Mayo');
  for (const c of [viejo, reciente]) fs.mkdirSync(c, { recursive: true });
  fs.writeFileSync(path.join(viejo, '1_a.jpg'), 'x');
  fs.writeFileSync(path.join(reciente, '2_b.jpg'), 'y');
  db.prepare("INSERT INTO evidencias (folio, archivo) VALUES ('1', '2026-04_Abril/1_a.jpg')").run();
  assert.deepEqual(await paquetes.empaquetar(new Date(2026, 10, 3)), ['paquetes/2026/2026-04_Abril.zip']);
  assert.ok(fs.statSync(path.join(evidencias.CARPETA, 'paquetes/2026/2026-04_Abril.zip')).size > 0);
  assert.equal(fs.existsSync(viejo), false);
  assert.equal(fs.existsSync(reciente), true);
  assert.equal(evidencias.buscar({ folio: '1' }).find((e) => e.archivo.startsWith('2026-04')).paquete, 'paquetes/2026/2026-04_Abril.zip');
});

test('archivero de Edgar: entregas, viajes y combustible de un día', () => {
  const id = nota('77100', 'entregado');
  db.prepare("INSERT INTO historial_estados (nota_id, estado_anterior, estado_nuevo, fecha) VALUES (?, 'en_ruta', 'entregado', '2026-10-28 12:00:00')").run(id);
  const carga = db.prepare("INSERT INTO combustible (unidad, importe, concepto, mensaje, creado_en) VALUES (?, ?, ?, 'x', ?)");
  carga.run('RAM', 800, 'diesel', '2026-10-28 09:00:00');
  carga.run('NISSAN', 500, 'gasolina', '2026-10-28 18:00:00');
  carga.run('RAM', 900, 'diesel', '2026-10-29 09:00:00');
  const d = reporte.delDia('2026-10-28');
  assert.deepEqual(d.entregas.map((e) => [e.folio, e.chofer, e.camion]), [['77100', 'Darío', 'Ram 4000']]);
  assert.deepEqual(d.viajes, [{ chofer: 'Darío', unidad: 'Ram 4000', viajes: 1 }]);
  assert.equal(d.total_combustible, 1300);
  assert.equal(d.diesel, 800);
});
