const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. Debe ir antes de cargar los módulos.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');
delete process.env.POS_CONECTOR_ACTIVO;

const db = require('../src/db/connection');
const config = require('../src/config');
const conector = require('../src/integraciones/pos/conector');
const importador = require('../src/integraciones/importador');
const estado = require('../src/integraciones/estado');
const { caja } = require('../src/integraciones/caja');

const hace = (min) => new Date(Date.now() - min * 60_000).toISOString();
const item = (name, quantity, unit, extra = {}) => ({ name, quantity, unit, gross_cents: 0, ...extra });
const venta = (folio, extra = {}) => ({
  id: `s${folio}`, folio, mode: 'sale', created_at: hace(30), deleted_at: null, source: null,
  delivery_method: 'shipping', delivery_status: 'pending', total_cents: 175000,
  client_name: 'ROBERTO MOO MOLINA', client_phone: '+529991234567', client_address: 'C. 21 #100, Centro',
  items: [item('POLVO', 1.5, 'm'), item('CEMENTO TOLTECA', 10, 'piece'), item('ENVÍO', 1, 'piece')],
  ...extra,
});

// Un POS de mentira con las mismas funciones que expone el módulo (oficina en src/server/main.ts del POS).
function posFalso(ventas, retiros = []) {
  const registrados = [];
  return {
    registrados,
    ventasDesde: async (desde) => ventas.filter((v) => v.created_at >= desde),
    venta: async (id) => ventas.find((v) => v.id === id) ?? null,
    ventaPorFolio: async (t) => ventas.find((v) => `N${v.folio}` === t.toUpperCase() || String(v.folio) === t) ?? null,
    retirosDesde: async () => retiros,
    registrarRetiro: async (r) => {
      registrados.push(r);
      retiros.push({ id: `r${registrados.length}`, type: 'cash_out', amount_cents: -r.importeCents, description: r.motivo, voids_id: null, created_at: new Date().toISOString() });
      return `r${registrados.length}`;
    },
  };
}

test('apagado por omisión: no pasa nada al tablero ni se puede usar desde Sulema o Edgar', async () => {
  assert.equal(config.pos.conector.activo, false);
  conector.iniciar();
  assert.equal(estado.obtener().pos.ok, null);
  assert.match(estado.obtener().pos.mensaje, /Desactivado/);
  await assert.rejects(conector.rescatar('N1'), /desactivado/);
  await assert.rejects(conector.registrarRetiro({ importe: 100, motivo: 'gas ram' }), /desactivado/);
  assert.equal(caja().nombre, 'Pulpos'); // Sulema y Edgar siguen con Pulpos
  // Ni siquiera fija la fecha desde la que importaría.
  assert.equal(db.prepare("SELECT 1 FROM ajustes WHERE clave = 'pos_importar_desde'").get(), undefined);
});

test('ventas con envío al tablero, las de recoger en tienda se omiten, las de Pulpos no se repiten', async () => {
  const ventas = [
    venta(1316),
    venta(1317, { delivery_method: 'pickup' }),
    venta(1318, { source: 'pulpos' }),
    venta(1319, { client_name: null, client_phone: null, client_address: null, items: [item('ARENA', 2, 'm')] }),
  ];
  const api = posFalso(ventas);
  const r = await conector.revisarVentas(api, new Date(Date.now() - 86_400_000));
  assert.deepEqual(r, { nuevas: 2, eliminadas: [] });

  const n = db.prepare("SELECT * FROM notas WHERE origen = 'pos' AND folio = 'N1316'").get();
  assert.equal(n.material, 'POLVO');
  assert.equal(n.cantidad, 1.5);
  assert.equal(n.unidad, 'm³');
  assert.equal(n.total, 1750);
  assert.equal(n.direccion, 'C. 21 #100, Centro');
  assert.equal(n.telefono, '9991234567');
  assert.equal(n.detalle, '1.5 m³ POLVO\n10 pz CEMENTO TOLTECA'); // el envío no es material
  assert.equal(n.id_externo, 's1316');

  const sinCliente = db.prepare("SELECT n.*, c.nombre AS cliente FROM notas n JOIN clientes c ON c.id = n.cliente_id WHERE n.origen = 'pos' AND n.folio = 'N1319'").get();
  assert.equal(sinCliente.cliente, 'SIN NOMBRE N1319');
  assert.match(sinCliente.direccion, /^Sin dirección/);

  assert.match(importador.situacion('pos', 'N1317').resultado, /recoge en tienda/);
  assert.equal(importador.situacion('pos', 'N1318').resultado, null);

  // La siguiente vuelta no repite nada; si eliminan una que está en el tablero, se avisa.
  assert.deepEqual(await conector.revisarVentas(api, new Date(Date.now() - 86_400_000)), { nuevas: 0, eliminadas: [] });
  ventas[0].deleted_at = new Date().toISOString();
  assert.deepEqual(await conector.revisarVentas(api, new Date(Date.now() - 86_400_000)), { nuevas: 0, eliminadas: ['N1316'] });
});

test('la gasolina de la Caja del POS pasa a Edgar, y si anulan el retiro se quita', async () => {
  const retiros = [
    { id: 'm1', type: 'cash_out', amount_cents: -50000, description: 'gas nissan blanca', voids_id: null, created_at: hace(20) },
    { id: 'm2', type: 'cash_out', amount_cents: -20000, description: 'desayuno', voids_id: null, created_at: hace(15) },
  ];
  const api = posFalso([], retiros);
  assert.equal(await conector.revisarCaja(api), 1);
  const fila = db.prepare("SELECT * FROM combustible WHERE pulpos_id = 'pos:m1'").get();
  assert.equal(fila.unidad, 'NISSAN BLANCA');
  assert.equal(fila.importe, 500);
  assert.equal(fila.reporto, 'Punto de Venta (caja)');
  assert.equal(await conector.revisarCaja(api), 0);

  retiros.push({ id: 'm3', type: 'cash_out_void', amount_cents: 50000, description: 'Anulación', voids_id: 'm1', created_at: hace(5) });
  await conector.revisarCaja(api);
  assert.equal(db.prepare("SELECT 1 FROM combustible WHERE pulpos_id = 'pos:m1'").get(), undefined);
});

test('encendido: Sulema rescata por folio y Edgar registra el retiro en la Caja del POS', async () => {
  config.pos.conector.activo = true;
  try {
    const ventas = [venta(1400, { delivery_method: 'pickup', created_at: hace(60) })];
    const api = posFalso(ventas);
    conector.fuente.api = () => api;
    assert.equal(caja().nombre, 'el Punto de Venta');
    assert.equal(caja().corto, 'PV');

    importador.omitir('pos', 'N1400', 'recoge en tienda');
    const fuera = await conector.buscarFuera(0);
    assert.deepEqual(fuera.fuera_del_tablero.map((v) => v.folio), ['N1400']);

    const r = await conector.rescatar('n1400');
    assert.equal(r.ok, true);
    assert.equal(r.folio, 'N1400');
    assert.match(r.por_que_no_habia_entrado, /Recoge en Tienda/);
    assert.equal((await conector.rescatar('N1400')).ya_estaba, true);
    assert.equal((await conector.rescatar('N9999')).ok, false);

    await conector.registrarRetiro({ importe: 650.5, motivo: 'gas ram (Edgar)' });
    assert.deepEqual(api.registrados, [{ importeCents: 65050, motivo: 'gas ram (Edgar)' }]);
    assert.ok(db.prepare("SELECT 1 FROM combustible WHERE pulpos_id = 'pos:r1' AND unidad = 'RAM'").get());
  } finally {
    config.pos.conector.activo = false;
    conector.fuente.api = () => require('../src/pos').api();
  }
});
