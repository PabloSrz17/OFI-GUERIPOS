// Lee la imagen de un ticket de SICAR (PDF o foto del impreso) con Tesseract, aquí mismo en el
// navegador: la imagen no sale de la PC. El texto se convierte en datos de la nota para que alguien
// los revise; nada se guarda solo.
import { normalizar, formatear } from './telefono.js';

let trabajador = null;

// Se carga hasta la primera imagen: el motor pesa varios MB y la mayoría de las veces no se usa.
function motor() {
  trabajador ??= import('/vendor/tesseract/tesseract.esm.min.js').then(async ({ default: tesseract }) => {
    const w = await tesseract.createWorker('spa', 1, {
      workerPath: '/vendor/tesseract/worker.min.js',
      corePath: '/vendor/tesseract-core',
      langPath: '/vendor/tesseract-data/4.0.0',
      workerBlobURL: false,
      gzip: true,
    });
    await w.setParameters({ tessedit_pageseg_mode: '6' }); // un bloque de renglones: respeta las columnas del ticket
    return w;
  }).catch((err) => {
    trabajador = null; // para que se pueda volver a intentar
    throw err;
  });
  return trabajador;
}

// Agranda y pasa a blanco y negro (umbral de Otsu): con los tickets reales es la diferencia entre
// "VICADEL30" y "VIGA DE 1.30".
function preparar(imagen, escala) {
  const lienzo = document.createElement('canvas');
  lienzo.width = imagen.width * escala;
  lienzo.height = imagen.height * escala;
  const g = lienzo.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.filter = 'grayscale(1) contrast(1.4)';
  g.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  const pixeles = g.getImageData(0, 0, lienzo.width, lienzo.height);
  const d = pixeles.data;
  const histograma = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) histograma[d[i]]++;
  const total = d.length / 4;
  const suma = histograma.reduce((s, n, i) => s + i * n, 0);
  let sumaFondo = 0;
  let fondo = 0;
  let mejor = 0;
  let umbral = 127;
  histograma.forEach((n, i) => {
    fondo += n;
    sumaFondo += i * n;
    const frente = total - fondo;
    if (!fondo || !frente) return;
    const varianza = fondo * frente * (sumaFondo / fondo - (suma - sumaFondo) / frente) ** 2;
    if (varianza > mejor) {
      mejor = varianza;
      umbral = i;
    }
  });
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = d[i] > umbral ? 255 : 0;
  g.putImageData(pixeles, 0, 0);
  return lienzo;
}

// Cada imagen rinde mejor a distinto tamaño: se lee a los dos y se queda la de mayor confianza.
export async function leerImagen(archivo) {
  const w = await motor();
  const imagen = await createImageBitmap(archivo);
  let mejor = null;
  for (const escala of imagen.width > 2000 ? [1] : [2, 3]) {
    const { data } = await w.recognize(preparar(imagen, escala));
    if (!mejor || data.confidence > mejor.confianza) mejor = { texto: data.text, confianza: data.confidence };
  }
  imagen.close();
  return mejor;
}

const CANTIDAD = String.raw`\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?`;
const DINERO = String.raw`\$?\s*\d[\d.,]*[.,]\d{2}`; // el lector a veces cambia la coma de miles por punto
const UNIDADES = [
  [/^(m3|m³|mts?3?|metros?)$/i, 'm³'],
  [/^(pz|pza|pzas|piezas?)$/i, 'pz'],
  [/^(b|bolsas?)$/i, 'BOLSAS'],
  [/^bultos?$/i, 'bulto'],
  [/^viajes?$/i, 'viaje'],
  [/^(kg|kilos?)$/i, 'kg'],
  [/^(ton|toneladas?)$/i, 'ton'],
];
const MATERIALES = /polvo|grava|piedra|arena|tepetate|escombro|sello|relleno|tierra|balastre|cemento|mortero|\bcal\b|block|bloque|bovedilla|varilla|armex|malla|masilla|impermeabil|tubo|costal|viga|alambr|clavo|env[ií]o|flete/i;
// Renglones del ticket que traen números pero no son artículos.
const NO_ARTICULO = /^(sub\s*total|total|descuento|iva|cambio|efectivo|tarjeta|transferencia|cheque|vale|credito|cr[eé]dito|pago|cobro|fecha|hora|folio|venta|nota|ticket|cliente|nombre|tel|cel|direcc|domicilio|enviar|entregar|cant\b)/i;

const limpiarCantidad = (c) => (c.includes('/') ? c.replace(/\s+/g, ' ') : String(Number(c.replace(',', '.'))));
const unidadDe = (p) => UNIDADES.find(([re]) => re.test(p))?.[1] ?? null;
const importeDe = (t) => Number(t.replace(/[$\s]/g, '').replace(/[.,](?=.*[.,])/g, '').replace(',', '.'));
const decimal = (c) => (/^\d+(?:[.,]\d+)?$/.test(c) ? Number(c.replace(',', '.')) : null);

// Quita la basura que el lector deja en los bordes de la foto: "— VIGA DE 2.00 5.0 1,220.00 -"
const sinBordes = (linea) => linea
  .replace(/^[^\p{L}\p{N}]+/u, '')
  .replace(/(\d[.,]\d{2})\s+\S{1,2}$/, '$1')
  .replace(/[^\p{L}\p{N}]+$/u, '');
const sinGuiones = (t) => t.replace(/^[^\p{L}\p{N}]+/u, '').trim().toUpperCase();

function leerArticulo(lineaCruda) {
  const linea = sinBordes(lineaCruda);
  if (NO_ARTICULO.test(linea)) return null;
  // Ticket impreso de SICAR: "VIGA DE 4.00 25.0 12,200.00". Se revisa primero: la medida no es la cantidad.
  const impreso = linea.match(new RegExp(`^(.*[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}.*?)\\s+(\\d+[.,]\\d)\\.?\\s+(${DINERO})$`));
  if (impreso) {
    const material = sinGuiones(impreso[1].replace(/^\S\s+/, '')); // un carácter suelto es basura del borde
    return { cantidad: limpiarCantidad(impreso[2]), unidad: '', material, importe: importeDe(impreso[3]) };
  }
  // PDF de SICAR y otros: "25.0 PZA VIGA DE 4.00 $ 488.00 $ 12,200.00" o "7 m3 polvo"
  const alInicio = linea.match(new RegExp(`^(${CANTIDAD})\\.?\\s*[×xX]?\\s+(.+)$`));
  if (!alInicio) {
    // "CEMENTO MAYA 25 KG 1 $150.00" o con precio e importe
    const alFinal = linea.match(new RegExp(`^(.*[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}.*?)\\s+(${CANTIDAD})\\.?\\s+(?:${DINERO}\\s+)?(${DINERO})$`));
    return alFinal && { cantidad: limpiarCantidad(alFinal[2]), unidad: '', material: sinGuiones(alFinal[1]), importe: importeDe(alFinal[3]) };
  }
  // Con signo de pesos sólo se quita lo que lo trae: "VIGA DE 4.00 $ 488.00" conserva la medida.
  const finDinero = alInicio[2].includes('$')
    ? new RegExp(`((?:\\s+\\$\\s*\\d[\\d.,]*[.,]\\d{2}){1,2})\\s*$`)
    : new RegExp(`((?:\\s+${DINERO}){1,2})\\s*$`);
  const montos = alInicio[2].match(finDinero);
  const resto = alInicio[2].replace(finDinero, '').trim();
  const [primera, ...demas] = resto.split(/\s+/);
  const unidad = demas.length ? unidadDe(primera) : null;
  const material = sinGuiones(unidad ? demas.join(' ') : resto);
  if (!/[A-ZÁÉÍÓÚÑ]{3}/.test(material)) return null;
  // Con esto "20 de Noviembre" sigue siendo dirección y la basura de la pantalla no entra como artículo.
  if (!montos && !unidad && !MATERIALES.test(material)) return null;
  const articulo = { cantidad: limpiarCantidad(alInicio[1]), unidad: unidad ?? '', material };
  const dinero = [...(montos?.[1] ?? '').matchAll(/\d[\d.,]*[.,]\d{2}/g)].map((m) => importeDe(m[0]));
  if (dinero.length) articulo.importe = dinero.at(-1);
  if (dinero.length === 2) articulo.precio = dinero[0];
  return articulo;
}

// "Cliente: ANA" o "Cliente" con el dato en el renglón siguiente.
function etiquetado(lineas, etiqueta) {
  for (const [i, linea] of lineas.entries()) {
    const m = linea.match(etiqueta);
    if (m) return { valor: m[1].trim() || lineas[i + 1] || '', i };
  }
  return null;
}

// PDF de SICAR: las etiquetas grises ("Nombre:", "Cel:") no se leen, pero el bloque del cliente siempre
// va igual justo arriba de la tabla: nombre, RFC y celular, y domicilio con C.P.
const mayusculas = (l) => (String(l ?? '').match(/[A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 .,&#\/-]{3,}/g) ?? [])
  .reduce((a, b) => (b.length > a.length ? b : a), '').trim();
// Teléfono de 10 dígitos en el renglón; nunca el del negocio (981 134 88xx, impreso arriba en los tickets).
const NEGOCIO = /^98113488/;
function telefonoEn(linea) {
  for (const m of String(linea ?? '').matchAll(/(?<!\d)(\d(?:[\s.-]?\d){9})(?![\d])/g)) {
    const t = m[1].replace(/\D/g, '');
    if (!NEGOCIO.test(t)) return { telefono: m[1], antes: linea.slice(0, m.index) };
  }
  return null;
}
// Nombre en el mismo renglón que el celular ("OSCAR BACELIS 9811242123"): palabras de puras letras,
// sin el RFC ni la basura de etiquetas grises ("ai.", "ce").
const nombreAntes = (texto) => texto.split(/\s+/).filter((p) => /^[A-ZÁÉÍÓÚÑ&.]{2,}$/.test(p) && /[A-ZÁÉÍÓÚÑ]{2}/.test(p)).join(' ');

function receptorDelPdf(lineas) {
  const tabla = lineas.findIndex((l) => /^CANT\b.*DESCRIP/i.test(l));
  if (tabla < 0) return {};
  const inicio = Math.max(0, tabla - 8);
  const arriba = lineas.slice(inicio, tabla);
  const conCp = arriba.findLastIndex((l) => /C\.?\s*P\.?\s*:?\s*\d{5}/i.test(l));
  if (conCp >= 0 && conCp >= 2) {
    const k = inicio + conCp;
    const celular = String(lineas[k - 1] ?? '').match(/(\d(?:[\s.-]?\d){9})\s*\S{0,2}$/)?.[1];
    if (celular) return { cliente: mayusculas(lineas[k - 2]), celular, direccion: mayusculas(lineas[k]).replace(/\s*,?\s*C\.?\s*P\.?.*$/i, '') };
  }
  // Sin C.P. (o con otro acomodo): el celular es el último teléfono arriba de la tabla y el nombre va
  // en ese mismo renglón, antes del número, o en el de arriba.
  const i = arriba.findLastIndex((l) => telefonoEn(l));
  if (i < 0) return {};
  const { telefono, antes } = telefonoEn(arriba[i]);
  const mismo = nombreAntes(antes);
  return { cliente: mismo.split(' ').length >= 2 ? mismo : mayusculas(arriba[i - 1]), celular: telefono };
}

const OTRA_ETIQUETA = /^\W*(colon|ciudad|cel|tel|no\.?\s*cliente|comentario|r\.?f\.?c|cp\b|c\.p)/i;

function direccionDe(lineas) {
  const hallada = etiquetado(lineas, /\b(?:direcci[oó]n|domicilio|enviar a|entregar en)\b\s*[:.-]*\s*(.*)$/i);
  if (!hallada?.valor) return '';
  // En el ticket impreso la dirección sigue en el renglón de abajo.
  const partes = [hallada.valor];
  const siguiente = lineas[hallada.i + 1];
  if (siguiente && !OTRA_ETIQUETA.test(siguiente) && !/\d[.,]\d{2}/.test(siguiente)) partes.push(sinBordes(siguiente));
  return partes.join(' ').replace(/\s*,?\s*C\.?\s*P\.?\s*:?\s*\d{5}.*$/i, '').trim();
}

function horaDe(todo) {
  const m = todo.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?(?:\s*([ap])\.?\s*m\b)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3]?.toLowerCase() === 'p' && h < 12) h += 12;
  if (m[3]?.toLowerCase() === 'a' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

// Devuelve sólo lo que encontró. dudas: renglones o totales que no cuadran con sus propios números.
export function interpretarTicket(texto) {
  const lineas = String(texto ?? '').split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const todo = lineas.join('\n');
  const datos = {};

  const folio = todo.match(/\bticket\s+fecha[^\n]*\n[^\n]*?\b(\d{4,})\b/i)
    ?? todo.match(/\b(?:folio|(?:nota de )?venta|nota|ticket)\s*(?:n[oº°.]+\s*)?[:#.]?\s*([A-Z]{0,3}-?\d{2,})\b/i)
    ?? todo.match(/\bNOT\s*(\d{4,})\b/)
    ?? todo.match(/\b(N\d{3,4})\b/);
  if (folio) datos.folio = folio[1].toUpperCase();

  const cliente = etiquetado(lineas, /\b(?:cliente|nombre)\b\s*[:.-]*\s*(.*)$/i);
  // "Nombre: OSCAR BACELIS Cel: 9811242123 RFC: …": el nombre termina donde empieza otra etiqueta o un número.
  if (cliente?.valor) {
    const nombre = cliente.valor.replace(/\s+(?:tel|cel|whats|r\.?f\.?c|no\.?\s*cliente)\b.*$/i, '').replace(/\s+[\d(+].*$/, '').replace(/\s+\S$/, '').toUpperCase();
    if (/[A-ZÁÉÍÓÚÑ]{2}/.test(nombre)) datos.cliente = nombre;
  }

  const direccion = direccionDe(lineas);
  if (direccion) datos.direccion = direccion;

  // Sólo con etiqueta: el ticket impreso trae arriba el teléfono del negocio.
  for (const m of todo.matchAll(/\b(?:cel|tel|whats\w*)[^\n\d]*((?:\+?52[\s-]*)?\d(?:[\s.-]?\d){9})(?!\d)/gi)) {
    const telefono = normalizar(m[1]);
    if (telefono && !NEGOCIO.test(m[1].replace(/\D/g, '').slice(-10))) {
      datos.telefono = formatear(telefono);
      break;
    }
  }

  const receptor = receptorDelPdf(lineas);
  if (!datos.cliente && receptor.cliente) datos.cliente = receptor.cliente;
  if (!datos.direccion && receptor.direccion) datos.direccion = receptor.direccion;
  if (!datos.telefono && normalizar(receptor.celular)) datos.telefono = formatear(normalizar(receptor.celular));

  const totales = [...todo.matchAll(/^\W*total\b\D*(\d[\d.,]*[.,]\d{2})/gim)];
  if (totales.length) datos.total = String(importeDe(totales.at(-1)[1]));

  const hora = horaDe(todo);
  if (hora) datos.hora = hora;

  const articulos = lineas.map(leerArticulo).filter(Boolean);
  if (articulos.length) {
    let dudas = articulos.filter((a) => a.precio && decimal(a.cantidad) !== null
      && Math.abs(decimal(a.cantidad) * a.precio - a.importe) > 1).length;
    const suma = articulos.reduce((s, a) => s + (a.importe ?? 0), 0);
    if (datos.total && articulos.every((a) => a.importe) && Math.abs(suma - Number(datos.total)) > 1) dudas += 1;
    if (dudas) datos.dudas = dudas;
    // El PDF no siempre trae el total a la vista: si cada renglón cuadra con su precio, la suma es confiable.
    else if (!datos.total && articulos.every((a) => a.importe && a.precio)) datos.total = suma.toFixed(2);
    datos.articulos = articulos.map(({ cantidad, unidad, material }) => ({ cantidad, unidad, material }));
  }
  return datos;
}
