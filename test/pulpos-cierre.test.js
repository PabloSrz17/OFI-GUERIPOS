const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base de datos de prueba: nunca la real. Debe ir antes de cargar los módulos.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-prueba-')), 'prueba.sqlite');

const db = require('../src/db/connection');
const notas = require('../src/repositories/notas.repo');
const importador = require('../src/integraciones/importador');
const { revisarFilas } = require('../src/integraciones/pulpos/robot');
const { parseDetalle } = require('../src/integraciones/pulpos/parser');

const detalle = (cantidad) => parseDetalle(`Forma de Entrega
Entrega a domicilio
Enviar a: Calle 5 Centro
Cliente
JUAN
Cantidad
Subtotal
GR01
GRAVA M3
$550.00
Precio
${cantidad} $550.00
Entregar Productos
Total
$550.00`);

const fila = (Venta, Fecha = 'Hoy a las 10:00') => ({ Venta, Fecha, Cliente: 'JUAN', Total: '$550.00', href: `/sales/detail?id=${Venta}` });

test('una venta ilegible no detiene a las demás y se reintenta después', async () => {
  const desde = new Date(Date.now() - 86_400_000);
  const leer = async (href) => {
    if (href.includes('R2')) throw new Error('tiempo agotado');
    return detalle('1');
  };
  const r = await revisarFilas([fila('R2'), fila('R3'), fila('R4', 'Hace un rato')], desde, leer);
  assert.equal(r.nuevas, 1);
  assert.deepEqual(r.problemas, ['R2', 'R4']);
  assert.equal(importador.yaVisto('pulpos', 'R3'), true);
  assert.equal(importador.yaVisto('pulpos', 'R2'), false); // sigue pendiente de leer

  const otra = await revisarFilas([fila('R2'), fila('R3')], desde, async () => detalle('1'));
  assert.equal(otra.nuevas, 1); // R3 no se duplica
  assert.deepEqual(otra.problemas, []);
});

test('sólo entra lo que se reparte, aunque en Pulpos ya esté marcado como entregado', async () => {
  const desde = new Date(Date.now() - 86_400_000);
  const mostrador = { ...detalle('1'), formaEntrega: null };
  const conServicio = { ...mostrador, productos: [...mostrador.productos, { nombre: 'SERVICIO DE ENVIO', cantidad: 1, subtotal: 100 }] };
  const respuestas = { V1: detalle('1'), V2: mostrador, V3: conServicio };
  const r = await revisarFilas(
    [fila('V1'), fila('V2'), fila('V3'), { ...fila('V4'), Pago: 'Cancelada' }],
    desde,
    async (href) => respuestas[new URLSearchParams(href.split('?')[1]).get('id')],
  );
  assert.equal(r.nuevas, 2);
  assert.deepEqual(r.problemas, []);
  assert.equal(notas.listarTablero().some((n) => n.folio === 'V1'), true);
  assert.equal(notas.listarTablero().some((n) => n.folio === 'V3'), true);
  assert.equal(notas.listarTablero().some((n) => n.folio === 'V2'), false);
  assert.equal(importador.yaVisto('pulpos', 'V2'), true); // no se vuelve a abrir
  assert.equal(importador.yaVisto('pulpos', 'V4'), false);
});

test('una venta sin cliente lleva nombre propio, no el texto de Pulpos', () => {
  const { aVenta } = require('../src/integraciones/pulpos/parser');
  const sinCliente = { ...detalle('1'), cliente: 'Asignar Cliente' };
  assert.equal(aVenta({ ...fila('S1'), Cliente: '' }, sinCliente, 'x').cliente.nombre, 'SIN NOMBRE S1');
  assert.equal(aVenta(fila('S2'), sinCliente, 'x').cliente.nombre, 'JUAN');
});

test('cantidades de Pulpos con miles o decimales', () => {
  assert.equal(detalle('1,000').productos[0].cantidad, 1000);
  assert.equal(detalle('1,000.5').productos[0].cantidad, 1000.5);
  assert.equal(detalle('1,5').productos[0].cantidad, 1.5);
  assert.equal(detalle('7').productos[0].cantidad, 7);
});

test('el cierre archiva lo entregado y conserva lo demás', () => {
  const crear = (folio, estado) => {
    const n = importador.registrar({
      cliente: { nombre: 'CLIENTE' },
      nota: { origen: 'sicar', folio, material: 'GRAVA', cantidad: 1, unidad: 'm³', direccion: 'Centro' },
    });
    db.prepare('UPDATE notas SET estado = ? WHERE id = ?').run(estado, n.id);
    return n.id;
  };
  const antes = notas.resumen();
  const pendiente = crear('C1', 'pendiente');
  const cargando = crear('C2', 'cargando');
  const ruta = crear('C3', 'en_ruta');
  const entregada = crear('C4', 'entregado');
  const fechaAntes = notas.obtener(pendiente).actualizado_en;

  const r = notas.cerrarJornada();
  assert.equal(r.archivadas, 1);
  assert.equal(r.conservadas.pendiente, antes.pendiente + 1);
  assert.equal(r.conservadas.cargando, antes.cargando + 1);
  assert.equal(r.conservadas.enRuta, antes.en_ruta + 1);

  const tablero = notas.listarTablero().map((n) => n.id);
  assert.ok([pendiente, cargando, ruta].every((id) => tablero.includes(id)));
  assert.ok(!tablero.includes(entregada));
  assert.equal(notas.obtener(pendiente).estado, 'pendiente');
  assert.equal(notas.obtener(pendiente).actualizado_en, fechaAntes);
  assert.ok(notas.historialGeneral().some((n) => n.id === entregada));
  assert.equal(notas.resumen().entregado_hoy, 0);
  assert.equal(notas.cerrarJornada().archivadas, 0); // cerrar otra vez no hace nada

  const nueva = crear('C5', 'entregado'); // lo que se entregue después sí aparece
  assert.ok(notas.listarTablero().some((n) => n.id === nueva));
});
