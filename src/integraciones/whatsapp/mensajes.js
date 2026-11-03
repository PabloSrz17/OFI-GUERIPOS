// Textos de los avisos al cliente. Edítalos aquí; se reinicia la Oficina para que tomen efecto.
const { whatsapp } = require('../../config');

const primerNombre = (cliente) => {
  const nombre = String(cliente ?? '').trim().split(/\s+/)[0] ?? '';
  return nombre && !/^p[uú]blico$/i.test(nombre) ? ` ${nombre.charAt(0)}${nombre.slice(1).toLowerCase()}` : '';
};

// Todos los materiales de la nota. Con varios, están en "detalle", un renglón por producto. No van el
// aviso interno de revisar en Pulpos ni el servicio de envío, que no es material (igual que en la hoja).
function materiales(nota) {
  const renglones = String(nota.detalle ?? '').split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('⚠️') && !/SERVICIO|ENV[IÍ]O|FLETE/i.test(l))
    .map((l) => `• ${l.replace(/\s×\s/, ' ').toLowerCase()}`);
  if (renglones.length) return renglones;
  if (/VER EN PULPOS/.test(nota.material)) return ['• Los materiales de tu nota'];
  return [`• ${[nota.cantidad, nota.unidad].filter(Boolean).join(' ').toLowerCase()} de ${String(nota.material).toLowerCase()}`];
}

function enRuta(nota) {
  return [
    `¡Hola${primerNombre(nota.cliente)}! 👋 Te escribimos de *${whatsapp.negocio}*.`,
    '',
    `Tu pedido *${nota.folio}* ya va en camino 🚚`,
    ...materiales(nota),
    '',
    nota.chofer ? `• Lo lleva: ${nota.chofer}${nota.camion ? ` en la ${nota.camion}` : ''}` : null,
    `• Entrega en: ${nota.direccion}`,
    '',
    '¡Gracias por tu compra!',
  ].filter((l) => l !== null).join('\n');
}

// Según la hora en que sale el mensaje: 00:00–11:59 días, 12:00–18:59 tardes, 19:00–23:59 noches.
function saludo(fecha = new Date()) {
  const hora = fecha.getHours();
  return hora < 12 ? 'buenos días' : hora < 19 ? 'buenas tardes' : 'buenas noches';
}
const conMayuscula = (t) => t[0].toUpperCase() + t.slice(1);

// Respuesta automática de El Inspector: nunca lleva precios.
function bienvenida(fecha = new Date()) {
  return [
    `¡Hola, ${saludo(fecha)}! 😊 Qué gusto saludarle, gracias por escribirnos a *${whatsapp.negocio}*.`,
    '',
    'Con mucho gusto le ayudamos. Para darle su cotización, ¿nos comparte por favor estos datos?',
    '',
    '🧱 ¿Qué material necesita?',
    '📍 ¿En qué colonia o poblado es la entrega?',
    '💳 ¿Cómo le gustaría pagar?',
  ].join('\n');
}

// Recordatorio de 24 horas: el saludo se calcula al momento de mandarlo.
const seguimiento = (fecha = new Date()) => `${conMayuscula(saludo(fecha))}, ¿qué le pareció la cotización? ¿Algo más en lo que podamos ayudarle?`;

module.exports = { enRuta, bienvenida, seguimiento, saludo };
