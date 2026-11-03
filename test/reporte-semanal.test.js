const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. Debe ir antes de cargar los módulos.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');

const db = require('../src/db/connection');
const reporte = require('../src/repositories/reporte.repo');

// Semana de prueba: lunes 26 de octubre 08:00 al cierre del sábado 31 de octubre de 2026.
const cliente = db.prepare("INSERT INTO clientes (nombre) VALUES ('CLIENTE REPORTE')").run().lastInsertRowid;
const chofer = (nombre) => db.prepare('INSERT INTO choferes (nombre) VALUES (?)').run(nombre).lastInsertRowid;
const camion = (nombre) => db.prepare('INSERT INTO camiones (nombre) VALUES (?)').run(nombre).lastInsertRowid;

function cotizacion(creado_en, estado = 'aprobada', pagada_en = null) {
  db.prepare('INSERT INTO cotizaciones (cliente_id, total, estado, creado_en, pagada_en) VALUES (?, 100, ?, ?, ?)')
    .run(cliente, estado, creado_en, pagada_en);
}

let folio = 0;
function nota({ estado = 'entregado', chofer_id = null, camion_id = null, entregas = [] }) {
  folio += 1;
  const id = db.prepare(`INSERT INTO notas (folio, cliente_id, material, cantidad, direccion, estado, chofer_id, camion_id)
    VALUES (?, ?, 'GRAVA', 1, 'CENTRO', ?, ?, ?)`).run(`R${folio}`, cliente, estado, chofer_id, camion_id).lastInsertRowid;
  for (const fecha of entregas) {
    db.prepare("INSERT INTO historial_estados (nota_id, estado_anterior, estado_nuevo, fecha) VALUES (?, 'en_ruta', 'entregado', ?)").run(id, fecha);
  }
}

test('la semana va del lunes 08:00 al cierre del sábado; el domingo es de la que acaba de cerrar', () => {
  const esperada = { inicio: '2026-10-26 08:00:00', fin: '2026-11-01 00:00:00' };
  for (const dia of ['2026-10-26', '2026-10-28', '2026-10-31', '2026-11-01']) assert.deepEqual(reporte.semana(dia), esperada, dia);
  assert.deepEqual(reporte.semana('2026-11-02'), { inicio: '2026-11-02 08:00:00', fin: '2026-11-08 00:00:00' });
  assert.deepEqual(reporte.semana('2027-01-01'), { inicio: '2026-12-28 08:00:00', fin: '2027-01-03 00:00:00' });
});

test('Chatito: cotizaciones de la semana y, de ésas, las pagadas antes del cierre', () => {
  cotizacion('2026-10-26 07:59:59', 'pagada', '2026-10-27 10:00:00'); // antes de las 8 del lunes
  cotizacion('2026-10-26 08:00:00', 'pagada', '2026-10-27 10:00:00'); // cuenta y pagada
  cotizacion('2026-10-29 12:00:00', 'cerrada'); // cerrada es sin venta
  cotizacion('2026-10-31 23:00:00', 'pagada', '2026-11-02 09:00:00'); // pagada ya en la otra semana
  cotizacion('2026-11-01 01:00:00', 'pagada', '2026-11-01 02:00:00'); // domingo
  cotizacion('2026-10-20 09:00:00', 'pagada', '2026-10-28 09:00:00'); // de la semana anterior, pagada en ésta
  assert.deepEqual(reporte.generar('2026-10-28').chatito, { creadas: 3, pagadas: 1 });
});

test('Octavio: órdenes sin las descartadas y entradas de la semana', () => {
  const orden = db.prepare("INSERT INTO ordenes_compra (clave, solicitante, estado, creado_en) VALUES ('1', 'CONCORDIA', ?, ?)");
  orden.run('aprobada', '2026-10-27 09:00:00');
  orden.run('cancelada', '2026-10-30 09:00:00');
  orden.run('descartada', '2026-10-27 10:00:00');
  orden.run('aprobada', '2026-11-02 09:00:00');
  const entrada = db.prepare("INSERT INTO entradas_almacen (folio, renglones, creado_en) VALUES ('F1', '[]', ?)");
  entrada.run('2026-10-31 18:00:00');
  entrada.run('2026-10-25 18:00:00');
  assert.deepEqual(reporte.generar('2026-10-28').octavio, { ordenes: 2, entradas: 1 });
});

test('Edgar: entregas de la semana por chofer y unidad, sin las regresadas', () => {
  const dario = chofer('Darío');
  const jose = chofer('José');
  const ram = camion('Ram 4000');
  const dina = camion('Dina');
  nota({ chofer_id: dario, camion_id: ram, entregas: ['2026-10-28 13:00:00'] });
  nota({ chofer_id: dario, camion_id: ram, entregas: ['2026-10-19 13:00:00', '2026-10-30 13:00:00'] }); // la última cuenta
  nota({ chofer_id: dario, camion_id: dina, entregas: ['2026-10-29 13:00:00'] });
  nota({ chofer_id: jose, camion_id: ram, entregas: ['2026-10-31 20:00:00'] });
  nota({ chofer_id: jose, camion_id: ram, entregas: ['2026-10-30 10:00:00', '2026-11-02 10:00:00'] }); // última: otra semana
  nota({ chofer_id: jose, camion_id: dina, estado: 'en_ruta', entregas: ['2026-10-29 10:00:00'] }); // la regresaron
  nota({ chofer_id: jose, camion_id: dina, entregas: ['2026-10-24 10:00:00'] });
  assert.deepEqual(reporte.generar('2026-10-28').edgar, {
    despachados: 4,
    viajes: [
      { chofer: 'Darío', unidad: 'Ram 4000', viajes: 2 },
      { chofer: 'Darío', unidad: 'Dina', viajes: 1 },
      { chofer: 'José', unidad: 'Ram 4000', viajes: 1 },
    ],
  });
});
