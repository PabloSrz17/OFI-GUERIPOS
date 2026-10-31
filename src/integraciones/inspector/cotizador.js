// El Inspector (reglas fijas): interpreta una solicitud escrita en una línea y arma el borrador
// de cotización con la lista de precios y el flete por colonia. Funciones puras: los datos
// (catálogo, flete) se pasan como parámetros, así se prueban sin base de datos.
//
//   "Construcomer, 7 m3 polvo + 10 cemento maya, Pensiones, tel 981 118 3096"
//   Orden: cliente, productos (separados con +); después, en cualquier orden: colonia y teléfono.

const { parseProducto } = require('../sicar/texto');
const { normalizar: normalizarTelefono } = require('../../lib/telefono');

// "Cemento MAYA, 25kg" -> "cemento maya 25kg" (minúsculas, sin acentos ni signos)
const clave = (texto) => String(texto ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();

const capitalizar = (texto) => {
  const t = String(texto ?? '').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function interpretarSolicitud(linea) {
  const partes = String(linea ?? '').split(/[,;\n]/).map((p) => p.trim()).filter(Boolean);
  const cliente = partes.shift() ?? '';
  let productos = [];
  let telefono = null;
  const colonia = [];

  for (const parte of partes) {
    const tel = /^(tel[eé]?f?o?n?o?\.?|cel\.?|whats(app)?)?[\s:]*[+\d][\d\s.-]{8,}$/i.test(parte)
      ? normalizarTelefono(parte) : null;
    const items = parte.split('+').map((p) => {
      const producto = parseProducto(p);
      return producto && { ...producto, texto: p.trim().replace(/^\d+(?:[.,]\d+)?\s*/, '') };
    });
    if (tel) telefono = tel;
    else if (!productos.length && items.every(Boolean)) productos = items;
    else colonia.push(parte.replace(/^col(onia)?\.?\s+(de\s+)?/i, ''));  // "col. Centro", "colonia de X"
  }

  const faltan = [];
  if (!cliente) faltan.push('el cliente (primer dato)');
  if (!productos.length) faltan.push('los productos, ej. "7 m3 polvo + 10 cemento maya"');
  if (!colonia.length) faltan.push('la colonia (para el flete)');
  if (faltan.length) {
    const lista = faltan.length > 1 ? `${faltan.slice(0, -1).join(', ')} y ${faltan.at(-1)}` : faltan[0];
    return { ok: false, error: `Me ${faltan.length > 1 ? 'faltan' : 'falta'}: ${lista}.` };
  }
  return { ok: true, solicitud: { cliente: cliente.toUpperCase(), telefono, colonia: colonia.join(', '), productos } };
}

// Busca el producto en el catálogo por la clave más larga que aparezca como palabras completas
// ("cal" no coincide con "calle"; "cemento maya" gana sobre "maya").
function buscarPrecio(catalogo, texto) {
  const t = ` ${clave(texto)} `;
  let mejor = null;
  let largo = 0;
  for (const p of catalogo) {
    for (const c of p.claves.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (t.includes(` ${c} `) && c.length > largo) {
        mejor = p;
        largo = c.length;
      }
    }
  }
  return mejor;
}

const redondear = (n) => Math.round(n * 100) / 100;

// "1/2" -> 0.5, "1 1/2" -> 1.5, "7" -> 7, "1,5" -> 1.5; lo que no es cantidad da NaN.
function aNumero(valor) {
  const t = String(valor ?? '').trim();
  const m = t.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
  if (m) return Number(m[3]) > 0 ? Number(m[1] ?? 0) + Number(m[2]) / Number(m[3]) : NaN;
  return t ? Number(t.replace(',', '.')) : NaN;
}

// Borrador: partidas con precio (o null si hay que preguntarlo) y el flete de la colonia.
function armarBorrador(solicitud, catalogo, flete) {
  const partidas = solicitud.productos.map((p) => {
    const hallado = buscarPrecio(catalogo, p.texto);
    // Pedido en bolsas y la lista lo vende por m³: ese precio no aplica, lo pone un humano.
    const encontrado = /^bols/i.test(p.unidad ?? '') && !/^bols/i.test(hallado?.unidad ?? '') ? null : hallado;
    return {
      tipo: 'producto',
      descripcion: encontrado ? encontrado.nombre : capitalizar(p.texto),
      cantidad: p.cantidad,
      unidad: encontrado ? encontrado.unidad : p.unidad,
      precio: encontrado ? encontrado.precio : null,
      precio_id: encontrado?.id ?? null,
      texto: p.texto,
    };
  });
  partidas.push({
    tipo: 'flete',
    descripcion: `Flete a ${solicitud.colonia}`,
    cantidad: 1,
    unidad: 'viaje',
    precio: flete ? flete.precio : null,
    precio_id: null,
    texto: solicitud.colonia,
  });
  return { ...solicitud, partidas };
}

// Revisa y recalcula una cotización ya corregida por el usuario (no se confía en los totales del navegador).
// El flete es opcional: sin precio o en $0 no aparece en la cotización.
function calcular(partidas) {
  const conCobro = partidas.filter((p) => p.tipo !== 'flete' || Number(p.precio) > 0);
  const limpias = conCobro.map((p, i) => {
    const cantidad = aNumero(p.cantidad);
    const precio = Number(p.precio);
    if (!String(p.descripcion ?? '').trim()) throw new Error(`Falta la descripción en el renglón ${i + 1}`);
    if (!(cantidad > 0)) throw new Error(`Cantidad inválida en "${p.descripcion}"`);
    if (p.precio === null || p.precio === '' || !(precio >= 0)) throw new Error(`Falta el precio de "${p.descripcion}"`);
    return { ...p, descripcion: String(p.descripcion).trim(), cantidad, precio, importe: redondear(cantidad * precio) };
  });
  return { partidas: limpias, total: redondear(limpias.reduce((s, p) => s + p.importe, 0)) };
}

module.exports = { interpretarSolicitud, buscarPrecio, armarBorrador, calcular, aNumero, clave, capitalizar };
