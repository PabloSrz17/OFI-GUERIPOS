// Interpreta una nota de SICAR escrita en una línea, separada por comas:
//   "33219, Luis Roman, 7 m3 polvo + 10 bultos cemento, Calle 5 #20 Centro, $3500, 10:25"
// Orden: folio, cliente, productos; después, en cualquier orden: dirección, total ($), hora (HH:MM)
// y teléfono (10 dígitos; si no va aparte, se busca dentro de la dirección).
// Varios productos se separan con "+".
const { normalizar, buscarEnTexto } = require('../../lib/telefono');

const UNIDADES = [
  [/^(m3|m³|mts?3?|metros?(\s+c[uú]bicos?)?)$/i, 'm³'],
  [/^(pz|pza|pzas|piezas?)$/i, 'pz'],
  [/^(b|bolsas?)$/i, 'BOLSAS'],
  [/^bultos?$/i, 'bulto'],
  [/^viajes?$/i, 'viaje'],
  [/^(kg|kilos?)$/i, 'kg'],
  [/^(ton|tons|toneladas?)$/i, 'ton'],
];
// Materiales a granel: si no se escribe unidad, se asume m³.
const A_GRANEL = /polvo|grava|piedra|arena|tepetate|escombro|sello|gravilla|relleno|tierra|balastre/i;

function unidadDe(texto) {
  return UNIDADES.find(([re]) => re.test(texto))?.[1] ?? null;
}

// CB y C/B son CON BOLSA.
const conBolsa = (texto) => String(texto ?? '').replace(/(^|\s)(cb|c\/b)(?=\s|$)/gi, '$1CON BOLSA');

// "10 b polvo cb" -> "10 BOLSAS polvo CON BOLSA". Vale para lo escrito en los campos o en la lista.
function lineaConEmpaque(linea) {
  return conBolsa(linea).replace(/^(\d[\d.,/]*(?:\s+\d+\/\d+)?)\s+(?:(?:m3|m³)\s+)?b(?=\s)/i, '$1 BOLSAS');
}

// B y CB en los datos de una nota capturada o editada a mano.
function datosConEmpaque(datos) {
  return {
    ...datos,
    material: conBolsa(datos.material).replace(/^b\s+/i, ''),
    unidad: unidadDe(datos.unidad) === 'BOLSAS' || /^b\s/i.test(datos.material) ? 'BOLSAS' : datos.unidad,
    detalle: datos.detalle ? datos.detalle.split('\n').map((l) => (l.startsWith('⚠️') ? l : lineaConEmpaque(l))).join('\n') : datos.detalle,
  };
}

// "7 m3 polvo" | "7m3 polvo" | "10 bultos cemento" | "7 polvo"
function parseProducto(texto) {
  const m = texto.trim().match(/^(\d+(?:[.,]\d+)?)\s*(.+)$/);
  if (!m) return null;
  const cantidad = Number(m[1].replace(',', '.'));
  let resto = m[2].trim();
  let unidad = null;
  const palabras = resto.split(/\s+/);
  for (const n of [3, 2, 1]) { // "metros cubicos", "m3"
    const candidata = palabras.slice(0, n).join(' ');
    if (palabras.length > n && unidadDe(candidata)) {
      unidad = unidadDe(candidata);
      resto = palabras.slice(n).join(' ').replace(/^de\s+/i, '');
      break;
    }
  }
  // "15 m3 b polvo": la B manda, son bolsas.
  if (unidad && /^b\s+\S/i.test(resto)) {
    unidad = 'BOLSAS';
    resto = resto.replace(/^b\s+/i, '');
  }
  if (!(cantidad > 0) || !resto) return null;
  const material = conBolsa(resto).toUpperCase();
  return { cantidad, unidad: unidad ?? (A_GRANEL.test(material) ? 'm³' : 'pz'), material };
}

// Producto de una nota: además de lo anterior acepta fracciones ("1/2 m3 grava", "1 1/2 bultos cal").
// Sólo para notas: la cotización necesita una cantidad numérica para calcular, usa parseProducto.
function productoDeNota(texto) {
  const f = texto.trim().match(/^(\d+\s+\d+\/\d+|\d+\/\d+)\s*(.+)$/);
  if (f) {
    const p = parseProducto(`1 ${f[2]}`);
    return p && { ...p, cantidad: f[1] };
  }
  const p = parseProducto(texto);
  return p?.material.startsWith('/') ? productoLibre(texto) : p; // "1 m³ /2 M3 GRAVA"
}

// Anotación libre: la última palabra es el material y lo anterior la cantidad, tal como se escribió.
function productoLibre(texto) {
  const palabras = texto.trim().split(/\s+/);
  if (palabras.length < 2) return null;
  return { cantidad: palabras.slice(0, -1).join(' '), unidad: '', material: palabras.at(-1).toUpperCase() };
}

// Un renglón con cantidad sin duda es material: trae unidad o una palabra de la lista. Con esto
// "20 de Noviembre" sigue siendo dirección, pero "5 B GRAVA C/B" o "1 ENVIO" no.
const MATERIALES = /polvo|grava|piedra|arena|tepetate|escombro|sello|relleno|tierra|balastre|cemento|mortero|\bcal\b|block|bovedilla|varilla|armex|malla|masilla|impermeabil|tubo|costal|viga|alambr|clavo|env[ií]o|flete/i;
function esMaterialSeguro(texto, producto) {
  if (!producto) return false;
  const [, , unidad] = texto.trim().match(/^(\S+)\s+(\S+)/) ?? [];
  return Boolean(unidad && unidadDe(unidad)) || /^\d+(?:[.,]\d+)?\s*(m3|m³)/i.test(texto.trim()) || MATERIALES.test(producto.material);
}

// "7 m3 polvo + 10 bultos cemento + Cal": cada pedazo es un producto. El que no trae cantidad se
// queda sin ella, para que alguien la ponga, pero no tumba a los demás.
function leerProductos(parte) {
  const pedazos = parte.split('+').map((p) => p.trim()).filter(Boolean);
  const items = pedazos.map(productoDeNota);
  if (pedazos.length < 2 || !items.some(Boolean)) return items;
  return items.map((p, i) => p ?? { cantidad: '', unidad: '', material: pedazos[i].toUpperCase() });
}

function interpretar(linea) {
  const partes = String(linea ?? '')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1') // "3,500" es un número, no dos datos
    .split(/[,;\n]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const errores = [];
  const folio = (partes.shift() ?? '').replace(/^(folio|nota|n°|no\.?)\s*/i, '').trim();
  const cliente = partes.shift() ?? '';

  let productos = [];
  let total = null;
  let hora = null;
  let telefono = null;
  const direccion = [];
  for (const parte of partes) {
    const dinero = parte.match(/^(?:total\s*)?\$\s*([\d,]+(?:\.\d+)?)$/i);
    const reloj = parte.match(/^(\d{1,2}:\d{2})$/);
    const tel = /^(tel[eé]?f?o?n?o?\.?|cel\.?|whats(app)?)?[\s:]*[+\d][\d\s.-]{8,}$/i.test(parte)
      ? normalizar(parte) : null;
    const items = leerProductos(parte);
    if (tel) telefono = tel;
    else if (dinero) total = Number(dinero[1].replace(/,/g, ''));
    else if (reloj) hora = reloj[1];
    else if (!productos.length && items.length && items.every(Boolean)) productos = items;
    // Más productos separados con coma, mientras no empiece la dirección.
    else if (productos.length && !direccion.length && items.length === 1 && esMaterialSeguro(parte, items[0])) productos.push(items[0]);
    else direccion.push(parte);
  }

  // "media carga grava": sin número al inicio; es producto sólo si después viene la dirección.
  if (!productos.length && direccion.length > 1) {
    const items = direccion[0].split('+').map(productoLibre);
    if (items.every(Boolean)) {
      productos = items;
      direccion.shift();
    }
  }

  if (!/^[\w-]+$/.test(folio)) errores.push('el folio (primer dato)');
  if (!cliente) errores.push('el cliente (segundo dato)');
  if (!productos.length) errores.push('los productos, ej. "7 m3 polvo"');
  if (!direccion.length) errores.push('la dirección');
  if (errores.length) {
    const lista = errores.length > 1 ? `${errores.slice(0, -1).join(', ')} y ${errores.at(-1)}` : errores[0];
    return { ok: false, error: `Me ${errores.length > 1 ? 'faltan' : 'falta'}: ${lista}.` };
  }

  // El principal debe tener cantidad; el orden de los renglones no cambia.
  const principal = productos.find((p) => p.cantidad !== '') ?? productos[0];
  const resto = productos.filter((p) => p !== principal);
  return {
    ok: true,
    nota: {
      origen: 'sicar',
      folio,
      cliente: cliente.toUpperCase(),
      material: principal.material,
      cantidad: principal.cantidad,
      unidad: principal.unidad,
      detalle: resto.length ? productos.map((p) => [p.cantidad, p.unidad, p.material].filter(Boolean).join(' ')).join('\n') : null,
      productos,
      total,
      direccion: direccion.join(', '),
      telefono: telefono ?? buscarEnTexto(direccion.join(' ')),
      hora,
    },
  };
}

module.exports = { interpretar, parseProducto, datosConEmpaque, unidadDe, conBolsa };
