// Lectura de fotos en esta PC con Tesseract (gratis, la foto no sale). Sólo sirve con letra impresa,
// derecha y clara: con las fotos reales del 2026-11-03 las listas a mano salieron ilegibles. Por eso
// es estricto: sólo regresa productos si TODOS los renglones con cantidad se entienden y existen en
// la lista de precios; si no, regresa null y Chatito usa la IA como antes.
const path = require('node:path');
const { renglonesDeTexto } = require('../octavio/ordenes');
const { buscarPrecio } = require('./cotizador');
const { dbPath } = require('../../config');

const CONFIANZA_MIN = 80;
const IDIOMA = path.join(__dirname, '..', '..', '..', 'node_modules', '@tesseract.js-data', 'spa', '4.0.0_best_int');

let lector = null;
const abrir = () => {
  lector ??= require('tesseract.js').createWorker('spa', 1, { langPath: IDIOMA, gzip: true, cachePath: path.dirname(dbPath) })
    .catch((err) => { lector = null; throw err; });
  return lector;
};

// Sólo JPEG o PNG de verdad (por los primeros bytes).
const esImagen = (b) => (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47);

// Con el texto ya leído: productos para la tarjeta, o null si no es confiable.
function productosDeTexto(texto, catalogo) {
  const conCantidad = String(texto).split('\n').map((l) => l.trim()).filter((l) => /\d/.test(l) && /\p{L}{3}/u.test(l));
  const productos = renglonesDeTexto(texto);
  if (!productos.length || productos.length !== conCantidad.length) return null;
  if (!productos.every((p) => buscarPrecio(catalogo, p.material))) return null;
  return productos.map((p) => ({ cantidad: p.cantidad, unidad: p.unidad ?? '', producto: p.material }));
}

async function leerLocal(media, catalogo) {
  const imagen = Buffer.from(media.data, 'base64');
  if (!esImagen(imagen)) return null;
  const { data } = await (await abrir()).recognize(imagen);
  const productos = data.confidence >= CONFIANZA_MIN ? productosDeTexto(data.text, catalogo) : null;
  console.log(`[inspector] Tesseract: confianza ${Math.round(data.confidence)}, ${productos ? `${productos.length} producto(s)` : 'no confiable, pasa a la IA'}`);
  return productos && { es_pedido: true, nombre_cliente: '', colonia: '', metodo_pago: '', productos };
}

module.exports = { leerLocal, productosDeTexto };
