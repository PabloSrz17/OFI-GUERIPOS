// ¿Con qué sistema de ventas trabajan Sulema y Edgar? Con el Punto de Venta nuevo si su conector está encendido;
// si no, con Pulpos. Los dos ofrecen lo mismo: buscar ventas fuera del tablero, rescatar una por folio y registrar
// un retiro de efectivo en su Caja.
const config = require('../config');

function caja() {
  if (config.pos.conector.activo) {
    const pos = require('./pos/conector');
    return { nombre: 'el Punto de Venta', corto: 'PV', activo: true, buscarFuera: pos.buscarFuera, rescatar: pos.rescatar, registrarRetiro: pos.registrarRetiro };
  }
  const pulpos = require('./pulpos/robot');
  return { nombre: 'Pulpos', corto: 'PS', activo: config.pulpos.activo, buscarFuera: pulpos.buscarFuera, rescatar: pulpos.rescatar, registrarRetiro: pulpos.registrarRetiro };
}

module.exports = { caja };
