// Datos iniciales. Sólo inserta si la base está vacía.
//   npm run seed           -> choferes + clientes y notas de demostración
//   npm run seed:choferes  -> sólo choferes (para operar con notas reales de Pulpos/SICAR)
// Para reiniciar: detén el servidor, borra data/database.sqlite* y vuelve a ejecutarlo.
// Ajusta CHOFERES y CAMIONES con tu flota (el camión se elige aparte en cada nota).
const db = require('./connection');

const soloChoferes = process.argv.includes('--solo-choferes');

if (db.prepare('SELECT COUNT(*) AS n FROM choferes').get().n > 0) {
  console.log('La base ya tiene datos; no se insertó nada.');
  process.exit(0);
}

const CHOFERES = ['Antonio', 'Moises Sosa', 'Moises Arias', 'Francisco'];
const CAMIONES = ['Nissan Blanca', 'Ram 4000', 'Ford F450', 'Nissan Roja', 'Torton'];
const clientes = [
  ['Constructora Del Valle', '5215500000001', 'Norte'],
  ['Ing. Ramírez (obra Las Palmas)', '5215500000002', 'Centro'],
  ['Doña Lupita Hernández', '5215500000003', 'Sur'],
  ['Desarrollos Altamira', '5215500000004', 'Oriente'],
];
// [folio, cliente, material, m³, dirección, zona, chofer, estado]
const notas = [
  ['N-1001', 1, 'Polvo', 7, 'Av. Industrial 450', 'Norte', 1, 'pendiente'],
  ['N-1002', 2, 'Grava 3/4', 14, 'Calle Palmas 12, fracc. Las Palmas', 'Centro', null, 'pendiente'],
  ['N-1003', 3, 'Arena', 3, 'Privada Olivo 8', 'Sur', 3, 'pendiente'],
  ['N-1004', 4, 'Piedra', 7, 'Lote 22, Desarrollo Altamira', 'Oriente', 2, 'en_ruta'],
  ['N-1005', 1, 'Escombro (retiro)', 7, 'Av. Industrial 450', 'Norte', 1, 'en_ruta'],
  ['N-1006', 2, 'Tepetate', 14, 'Calle Palmas 12, fracc. Las Palmas', 'Centro', 3, 'entregado'],
];

db.transaction(() => {
  const insChofer = db.prepare('INSERT INTO choferes (nombre) VALUES (?)');
  const insCamion = db.prepare('INSERT INTO camiones (nombre) VALUES (?)');
  CHOFERES.forEach((c) => insChofer.run(c));
  CAMIONES.forEach((c) => insCamion.run(c));
  if (soloChoferes) return;

  const insCliente = db.prepare('INSERT INTO clientes (nombre, telefono, zona) VALUES (?, ?, ?)');
  const insNota = db.prepare(`
    INSERT INTO notas (folio, cliente_id, material, cantidad, direccion, zona, chofer_id, estado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insHist = db.prepare('INSERT INTO historial_estados (nota_id, estado_anterior, estado_nuevo) VALUES (?, ?, ?)');
  clientes.forEach((c) => insCliente.run(...c));
  notas.forEach((n) => {
    const { lastInsertRowid } = insNota.run(...n);
    insHist.run(lastInsertRowid, null, n[7]);
  });
})();

console.log(soloChoferes
  ? `Listo: ${CHOFERES.length} choferes y ${CAMIONES.length} camiones.`
  : `Seed listo: ${CHOFERES.length} choferes, ${CAMIONES.length} camiones, ${clientes.length} clientes, ${notas.length} notas de demostración.`);
