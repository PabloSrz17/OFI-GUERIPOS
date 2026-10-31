// Registro de auditoría del robot: data/logs/pulpos-auditoria.log. De cada venta con envío guarda el
// texto tal como lo mostró Pulpos, los productos que se leyeron y las advertencias, para poder comparar
// si falta algo. Pulpos no tiene API: lo "crudo" es el texto de la pantalla, no un JSON.
// Lleva datos de clientes: es sólo local. Un fallo aquí nunca debe detener la importación.
const fs = require('node:fs');
const path = require('node:path');
const { dbPath } = require('../../config');

const ARCHIVO = path.join(path.dirname(dbPath), 'logs', 'pulpos-auditoria.log');

function escribir(texto) {
  try {
    fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true });
    fs.appendFileSync(ARCHIVO, `${texto}\n`);
  } catch (err) {
    console.error('[pulpos] auditoría:', err.message);
  }
}

const hora = () => new Date().toLocaleString('es-MX', { hour12: false });

function omitida(folio, detalle) {
  escribir(`${hora()} | ${folio} | sin envío | forma: ${detalle.formaEntrega ?? 'ninguna'} | ${detalle.productos.length} producto(s)`);
}

function importada(folio, detalle, venta) {
  if (venta.advertencias.length) console.warn(`[pulpos] ${folio}: ${venta.advertencias.join('; ')}`);
  escribir([
    `===== ${hora()} | ${folio} | importada`,
    'PRODUCTOS LEÍDOS:',
    ...detalle.productos.map((p) => `  ${p.cantidad} | ${p.unidad ?? '-'} | ${p.nombre || '(sin descripción)'} | $${p.subtotal}`),
    `Subtotal de la venta: ${detalle.subtotal ?? 'no aparece'} | Total: ${detalle.total}`,
    ...venta.advertencias.map((a) => `ADVERTENCIA: ${a}`),
    'TEXTO DE PULPOS:',
    detalle.crudo,
    '',
  ].join('\n'));
}

function error(folio, mensaje) {
  escribir(`${hora()} | ${folio} | ERROR | ${mensaje}`);
}

module.exports = { omitida, importada, error, ARCHIVO };
