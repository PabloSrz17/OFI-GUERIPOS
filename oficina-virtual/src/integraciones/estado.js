// Último estado conocido de cada conector; la oficina lo muestra y El Chasis alerta si falla.
// ok: true = funcionando, false = falla (alerta), null = desactivado o sin configurar.
const estados = {};

function reportar(origen, ok, mensaje) {
  estados[origen] = { ok, mensaje, fecha: new Date().toISOString() };
}

module.exports = { reportar, obtener: () => estados };
