const test = require('node:test');
const assert = require('node:assert/strict');

const estado = require('../src/integraciones/estado');
const avisos = require('../src/integraciones/avisos-celular');

test('WhatsApp caído: avisa una vez pasados los minutos y otra cuando vuelve', async () => {
  avisos.config.ntfy = 'https://ntfy.example/prueba';
  avisos.config.minutos = 10;
  const enviados = [];
  const enviar = async (url, op) => { enviados.push(Buffer.from(op.headers.Title.slice(10, -2), 'base64').toString()); };
  const min = 60_000;
  estado.reportar('whatsapp', false, 'Conectando…');
  await avisos.revisar(0, enviar);
  await avisos.revisar(9 * min, enviar);
  assert.equal(enviados.length, 0); // menos de 10 min: nada
  await avisos.revisar(10 * min, enviar);
  await avisos.revisar(20 * min, enviar);
  assert.deepEqual(enviados, ['WhatsApp sin conectar']); // una sola vez
  estado.reportar('whatsapp', true, 'Conectado');
  await avisos.revisar(21 * min, enviar);
  await avisos.revisar(22 * min, enviar);
  assert.deepEqual(enviados, ['WhatsApp sin conectar', 'WhatsApp volvió']);
});

test('un corte corto que se arregla solo no avisa nada', async () => {
  const enviados = [];
  const enviar = async () => { enviados.push(1); };
  estado.reportar('whatsapp', false, 'reintentando');
  await avisos.revisar(0, enviar);
  estado.reportar('whatsapp', true, 'Conectado');
  await avisos.revisar(3 * 60_000, enviar);
  estado.reportar('whatsapp', null, 'Desactivado');
  await avisos.revisar(60 * 60_000, enviar);
  assert.equal(enviados.length, 0);
});
