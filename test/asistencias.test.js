const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. Debe ir antes de cargar los módulos.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');

const asistencias = require('../src/repositories/asistencias.repo');

const HOY = new Date(2026, 9, 30, 12); // viernes
const estados = () => asistencias.semana('2026-10-26', '2026-10-31').marcas.map((m) => m.estado);

test('están los 10 trabajadores en orden', () => {
  const nombres = asistencias.semana('2026-10-26', '2026-10-31').trabajadores.map((t) => t.nombre);
  assert.deepEqual(nombres, ['Darío', 'Francisco', 'José', 'Moisés Arias', 'Moisés Sosa', 'Marcos', 'Gandhi', 'Zuriel', 'Plácido', 'Antonio']);
});

test('una marca por trabajador y día: se cambia y se quita', () => {
  asistencias.marcar(1, '2026-10-30', 'asistio', HOY);
  asistencias.marcar(1, '2026-10-30', 'falta', HOY);
  assert.deepEqual(estados(), ['falta']);
  asistencias.marcar(1, '2026-10-30', null, HOY);
  assert.deepEqual(estados(), []);
});

test('el recordatorio sale de lunes a sábado desde las 10:00, hasta que todos estén marcados', () => {
  const a = (h, dia = 30) => asistencias.pendienteHoy(new Date(2026, 9, dia, h, 0));
  assert.equal(a(9), false);
  assert.equal(a(10), true);
  assert.equal(a(10, 25), false); // domingo
  asistencias.semana('2026-10-30', '2026-10-30').trabajadores
    .forEach((t, i) => asistencias.marcar(t.id, '2026-10-30', i ? 'asistio' : 'falta', HOY));
  assert.equal(a(10), false);
  asistencias.semana('2026-10-30', '2026-10-30').trabajadores.forEach((t) => asistencias.marcar(t.id, '2026-10-30', null, HOY));
});

test('rechaza domingo, días futuros, fechas raras y trabajadores que no existen', () => {
  assert.throws(() => asistencias.marcar(1, '2026-10-25', 'asistio', HOY), /domingos/);
  assert.throws(() => asistencias.marcar(1, '2026-10-31', 'asistio', HOY), /no ha llegado/);
  assert.throws(() => asistencias.marcar(1, '2026-02-31', 'asistio', HOY), /Fecha inválida/);
  assert.throws(() => asistencias.marcar(999, '2026-10-30', 'asistio', HOY), /no encontrado/);
  assert.throws(() => asistencias.marcar(1, '2026-10-30', 'tarde', HOY), /Estado inválido/);
});
