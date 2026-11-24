const { buscarEnTexto } = require('../../lib/telefono');

// Interpreta el texto visible de Pulpos (lista y detalle de venta). Se basa en etiquetas
// ("Forma de Entrega", "Enviar a:") y no en clases CSS, que cambian con cada versión.

const lineas = (texto) => texto.split('\n').map((l) => l.trim()).filter(Boolean);
const dinero = (s) => Number(String(s).replace(/[$,\s]/g, '')) || 0;

// "Hoy a las 11:16" | "Ayer a las 08:07" | "27/10/2026 11:51:29"
function parseFecha(texto, ahora = new Date()) {
  const t = String(texto).trim();
  let m = t.match(/^(Hoy|Ayer) a las (\d{1,2}):(\d{2})/i);
  if (m) {
    const d = new Date(ahora);
    if (/ayer/i.test(m[1])) d.setDate(d.getDate() - 1);
    d.setHours(Number(m[2]), Number(m[3]), 0, 0);
    return d;
  }
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return null;
}

// unidad: la que trae el renglón en Pulpos ("metro", "lata", "kg"), si trae.
function unidadDe(nombre, unidad = null) {
  if (/m3|m³|metro/i.test(`${unidad ?? ''} ${nombre}`)) return 'm³';
  if (/viaje/i.test(`${unidad ?? ''} ${nombre}`)) return 'viaje';
  return unidad ?? 'pz';
}

// "1,000" y "1,000.5" llevan separador de miles; "1,5" es decimal.
const cantidadDe = (s) => Number(/,\d{3}(\.|$)/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.'));

// "0.5 metro." -> { cantidad: 0.5, unidad: 'metro' } | "6" | "1/2" | "1,000 pz" | "media" (tal cual)
function leerCantidad(texto) {
  const m = texto.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d[\d,]*(?:\.\d+)?)\s*(.*)$/);
  if (!m) return { cantidad: texto, unidad: null };
  return { cantidad: m[1].includes('/') ? m[1] : cantidadDe(m[1]), unidad: m[2].replace(/\.$/, '').trim() || null };
}

// Partidas: CÓDIGO / NOMBRE / $precio / tipo de precio / "cantidad [unidad] $subtotal"
// Cualquier renglón que termine en un importe es una partida: traiga la unidad que traiga.
function parseProductos(ls) {
  const inicio = ls.findIndex((l, i) => l === 'Subtotal' && ls[i - 1] === 'Cantidad');
  if (inicio < 0) return [];
  const finRel = ls.slice(inicio + 1).findIndex((l) => l === 'Entregar Productos' || l === 'Subtotal');
  const fin = finRel < 0 ? ls.length : inicio + 1 + finRel;

  const productos = [];
  let previo = inicio; // último renglón de la partida anterior
  for (let i = inicio + 1; i < fin; i++) {
    const m = ls[i].match(/^(.+?)\s+\$([\d,]+(?:\.\d+)?)$/);
    if (!m) continue;
    let j = i - 1;
    while (j > previo && !/^\$[\d,]+(\.\d+)?$/.test(ls[j])) j--; // precio unitario
    const conPrecio = j > previo;
    const nombreEn = conPrecio ? j - 1 : i - 1; // sin precio unitario, el nombre es lo de arriba
    productos.push({
      codigo: conPrecio && j - 2 > previo ? ls[j - 2] : null,
      nombre: nombreEn > previo ? ls[nombreEn] : '',
      ...leerCantidad(m[1]),
      subtotal: dinero(m[2]),
    });
    previo = i;
  }
  return productos;
}

const despuesDe = (ls, etiqueta) => {
  const i = ls.lastIndexOf(etiqueta);
  return i >= 0 ? ls[i + 1] ?? null : null;
};

function parseDetalle(texto) {
  const ls = lineas(texto);
  const enviarA = ls.find((l) => /^Enviar a:/i.test(l));
  const inicio = ls.findIndex((l, i) => l === 'Subtotal' && ls[i - 1] === 'Cantidad');
  const resto = inicio < 0 ? ls : ls.slice(inicio + 1);
  const subtotal = resto.indexOf('Subtotal');
  const total = resto.indexOf('Total'); // el de la nota: el de "Estado" baja a $0 si la devuelven
  return {
    productos: parseProductos(ls),
    formaEntrega: despuesDe(ls, 'Forma de Entrega'),
    direccion: enviarA ? enviarA.replace(/^Enviar a:\s*/i, '') : null,
    cliente: despuesDe(ls, 'Cliente'),
    subtotal: subtotal >= 0 ? dinero(resto[subtotal + 1]) : null,
    total: dinero(total >= 0 ? resto[total + 1] : despuesDe(ls, 'Total')),
    crudo: texto,
  };
}

// Lo que no cuadra en una venta. Nunca se descarta nada: se avisa para que alguien lo revise.
function advertenciasDe(detalle) {
  const avisos = [];
  if (!detalle.productos.length) avisos.push('no se pudo leer ningún producto');
  detalle.productos.forEach((p, i) => {
    if (!p.nombre) avisos.push(`el renglón ${i + 1} no trae descripción`);
    if (typeof p.cantidad !== 'number' && !String(p.cantidad).includes('/')) avisos.push(`cantidad desconocida "${p.cantidad}" en ${p.nombre || `renglón ${i + 1}`}`);
  });
  if (detalle.subtotal !== null) {
    const suma = detalle.productos.reduce((s, p) => s + p.subtotal, 0);
    if (Math.abs(suma - detalle.subtotal) > 0.5) avisos.push(`lo leído suma $${suma} y la venta dice $${detalle.subtotal}`);
  } else if (detalle.productos.length) {
    avisos.push('la venta no trae Subtotal para comprobar');
  }
  return avisos;
}

// "0.5 × POLVO POR METRO" | "1.5 kg ARENA": la unidad sólo si el nombre no la dice ya.
function lineaDe(p) {
  const nombre = p.nombre || 'SIN DESCRIPCIÓN';
  const dicha = !p.unidad || nombre.toLowerCase().includes(p.unidad.toLowerCase());
  return dicha ? `${p.cantidad} × ${nombre}` : `${p.cantidad} ${unidadDe('', p.unidad)} ${nombre}`;
}

// ¿Es para repartir? Lo dice la forma de entrega o un servicio de envío cobrado en la venta.
const esEnvio = (detalle) => /domicilio/i.test(detalle.formaEntrega ?? '')
  || detalle.productos.some((p) => /ENV[IÍ]O|FLETE/i.test(p.nombre));

// Fecha local en el formato de SQLite: "2026-10-29 11:16:00".
const fechaSQL = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`;
};

// fila: objeto { Venta, Fecha, Cliente, Total, … } de la lista; detalle: parseDetalle().
function aVenta(fila, detalle, idExterno, ahora = new Date()) {
  const fecha = parseFecha(fila.Fecha ?? '', ahora);
  // El envío sin costo no se anota en la tarjeta.
  const productos = detalle.productos.filter((p) => !(p.subtotal === 0 && /ENV[IÍ]O|FLETE/i.test(p.nombre)));
  const advertencias = advertenciasDe(detalle);
  // Sólo llega aquí si alguien pidió rescatarla: entra, pero con el aviso.
  if (/cancel|reembols/i.test(fila.Pago ?? '') || /devuelt/i.test(fila.Productos ?? '')) {
    advertencias.push(`en Pulpos está como ${fila.Pago || fila.Productos}`);
  }
  // Aun sin productos la nota entra: que aparezca en el tablero con el aviso, no que se pierda.
  const [principal = { nombre: 'VER EN PULPOS: NO SE PUDIERON LEER LOS PRODUCTOS', cantidad: 1, unidad: 'nota' }] = productos;
  // "Asignar Cliente" es el botón de Pulpos en ventas sin cliente. Cada una lleva su propio nombre:
  // si compartieran cliente, también compartirían teléfono y el aviso le llegaría a otra persona.
  const nombre = [detalle.cliente, fila.Cliente].find((n) => n && !/^asignar cliente$/i.test(n.trim()));
  const renglones = productos.length > 1 ? productos.map(lineaDe) : [];
  // El aviso va en la tarjeta para que se vea; la hoja de reparto lo ignora porque no empieza con cantidad.
  const aviso = advertencias.length ? `⚠️ REVISAR EN PULPOS: ${advertencias.join('; ')}` : null;
  if (aviso && productos.length === 1) renglones.push(lineaDe(principal));
  if (aviso) renglones.push(aviso);
  const detalleTexto = renglones.length ? renglones.join('\n') : null;
  return {
    // En Pulpos el teléfono suele venir escrito dentro de la dirección de envío.
    cliente: { nombre: nombre ?? `SIN NOMBRE ${fila.Venta}`, telefono: buscarEnTexto(detalle.direccion) },
    nota: {
      origen: 'pulpos',
      folio: fila.Venta,
      id_externo: idExterno,
      material: principal.nombre || 'SIN DESCRIPCIÓN',
      cantidad: principal.cantidad,
      unidad: principal.unidad === 'nota' ? 'nota' : unidadDe(principal.nombre, principal.unidad),
      detalle: detalleTexto,
      total: detalle.total || dinero(fila.Total),
      direccion: detalle.direccion || 'Sin dirección (ver en Pulpos)',
      telefono: buscarEnTexto(detalle.direccion),
      creado_en: fecha ? fechaSQL(fecha) : null,
    },
    advertencias,
  };
}

module.exports = { parseFecha, parseDetalle, aVenta, unidadDe, esEnvio, advertenciasDe };
