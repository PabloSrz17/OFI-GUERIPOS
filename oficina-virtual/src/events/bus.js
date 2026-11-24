const { EventEmitter } = require('node:events');

// Bus interno de eventos de dominio. Los módulos de los siguientes pasos se suscriben aquí
// sin tocar las rutas:
//   'nota:creada'  (nota)                -> Paso 3: El Chasis
//   'nota:estado'  ({ nota, anterior, retroceso }) -> Paso 2: WhatsApp (en_ruta) y Google Sheets (entregado)
//                  retroceso = true cuando se regresó un paso: no debe disparar avisos. Ojo: si una nota
//                  regresa de En Ruta y vuelve a salir, el módulo de WhatsApp debe evitar el doble mensaje.
//   'nota:asignada', 'cotizacion:creada', 'pizarron:cambio' -> sólo para refrescar pantallas (GET /api/eventos)
module.exports = new EventEmitter();
