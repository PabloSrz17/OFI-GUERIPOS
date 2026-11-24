// Envío parcial: reparte los renglones de una nota entre lo que va en este viaje y lo que queda de saldo.
const { httpError } = require('./errors');

const CANTIDAD = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)(?=\s|$)\s*(.*)$/;
const UNIDAD = /^(m³|m3|pz|bultos?|bolsas?|viajes?|kg|ton)\s+/i;

// "1 1/2" -> 1.5 | "1/2" -> 0.5 | "2,5" -> 2.5 | lo demás -> null
function aNumero(texto) {
  const t = String(texto ?? '').trim();
  const m = t.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
  if (m) return Number(m[3]) ? Number(m[1] ?? 0) + Number(m[2]) / Number(m[3]) : null;
  return /^\d+(?:[.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : null;
}

const redondear = (n) => Math.round(n * 1000) / 1000;

function deLinea(linea) {
  const m = linea.match(CANTIDAD);
  if (!m) return { texto: linea, cantidad: null, crudo: linea };
  const resto = m[2];
  const sinCruz = resto.replace(/^[×x]\s+/i, '');
  const unidad = sinCruz.match(UNIDAD)?.[1] ?? '';
  return { texto: linea, cantidad: m[1], resto, unidad, material: sinCruz.replace(UNIDAD, '') };
}

// Los renglones de la nota y sus avisos de revisar, que acompañan a cada parte.
function renglonesDe(nota) {
  const lineas = String(nota.detalle ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const avisos = lineas.filter((l) => l.startsWith('⚠️'));
  const productos = lineas.filter((l) => !l.startsWith('⚠️'));
  if (productos.length) return { renglones: productos.map(deLinea), avisos };
  const cantidad = String(nota.cantidad);
  const unico = { unidad: nota.unidad, material: nota.material };
  const resto = [nota.unidad, nota.material].filter(Boolean).join(' ');
  return {
    renglones: [aNumero(cantidad) === null
      ? { ...unico, texto: `${cantidad} ${resto}`, cantidad: null, crudo: cantidad }
      : { ...unico, texto: `${cantidad} ${resto}`, cantidad, resto }],
    avisos,
  };
}

const conCantidad = (r, n) => ({ ...r, cantidad: String(n), texto: `${n} ${r.resto}` });

const igual = (a, b) => Math.abs(a - b) < 1e-9;
const claveDe = (r) => (aNumero(r.cantidad) === null
  ? `?|${r.texto}`
  : `${String(r.unidad ?? '').toLowerCase().replace('m3', 'm³')}|${String(r.material).trim().toUpperCase()}`);

// Une cada producto del viaje con el mismo producto en sus saldos. Un producto que sólo está en el
// saldo también aparece: el viaje lo puede tomar.
function filasDe(nota, hermanas = []) {
  const filas = new Map();
  const fila = (r) => {
    const clave = claveDe(r);
    if (!filas.has(clave)) filas.set(clave, { base: r, propio: null, ajeno: null, enViaje: 0, enSaldo: 0, sinCantidad: aNumero(r.cantidad) === null });
    return filas.get(clave);
  };
  const propia = renglonesDe(nota);
  for (const r of propia.renglones) {
    const f = fila(r);
    f.enViaje += aNumero(r.cantidad) ?? 0;
    f.propio = f.propio ? { ...r, repetido: true } : r;
  }
  const avisos = new Set(propia.avisos);
  for (const hermana of hermanas) {
    const ajena = renglonesDe(hermana);
    ajena.avisos.forEach((a) => avisos.add(a));
    for (const r of ajena.renglones) {
      const f = fila(r);
      f.enSaldo += aNumero(r.cantidad) ?? 0;
      f.ajeno = f.ajeno ? { ...r, repetido: true } : r;
    }
  }
  return { filas: [...filas.values()], avisos: [...avisos] };
}

// Lo que ve la ventana de envío parcial, un elemento por producto.
function renglonesVentana(nota, hermanas = []) {
  return filasDe(nota, hermanas).filas.map((f) => ({
    texto: f.propio?.texto ?? `${f.base.texto} (en saldo)`,
    cantidad: f.sinCantidad ? null : f.propio && !f.propio.repetido ? f.propio.cantidad : String(redondear(f.enViaje)),
    va: Boolean(f.propio),
    enSaldo: redondear(f.enSaldo),
    maximo: redondear(f.enViaje + f.enSaldo),
  }));
}

// enviar: lo que se va en este viaje, en el orden de renglonesVentana. Sin cantidad: 1 se va y 0 se queda.
// El tope es lo del viaje más lo de sus saldos: lo que no se va queda en saldo.
function dividir(nota, enviar, hermanas = []) {
  const { filas, avisos } = filasDe(nota, hermanas);
  if (!Array.isArray(enviar) || enviar.length !== filas.length) {
    throw httpError(409, 'La nota cambió: vuelve a abrir el envío parcial');
  }
  const va = [];
  const queda = [];
  filas.forEach((f, i) => {
    const pedido = String(enviar[i] ?? '').trim();
    if (f.sinCantidad) {
      (aNumero(pedido) > 0 ? va : queda).push(f.base);
      return;
    }
    const total = f.enViaje + f.enSaldo;
    const sale = pedido === '' ? 0 : aNumero(pedido);
    if (sale === null) throw httpError(400, `Cantidad no válida: "${pedido}"`);
    if (sale > total + 1e-9) {
      throw httpError(400, f.enSaldo
        ? `No se puede enviar ${pedido}: entre este viaje y el saldo sólo hay ${redondear(total)} de ${f.base.material}`
        : `No se puede enviar ${pedido}: la nota sólo trae ${f.base.cantidad} de ${f.base.material}`);
    }
    // Si la cantidad no cambió, el renglón se queda como estaba escrito ("1/2", no "0.5").
    const renglon = (n) => {
      if (f.propio && !f.propio.repetido && igual(n, f.enViaje)) return f.propio;
      if (f.ajeno && !f.ajeno.repetido && igual(n, f.enSaldo)) return f.ajeno;
      return conCantidad(f.base, redondear(n));
    };
    if (sale > 1e-9) va.push(renglon(sale));
    if (total - sale > 1e-9) queda.push(renglon(total - sale));
  });
  return { va, queda, avisos };
}

// Campos de la nota para una lista de renglones. El principal es el primero con cantidad.
function armar(renglones, avisos) {
  const principal = renglones.find((r) => aNumero(r.cantidad) !== null) ?? renglones[0];
  return {
    cantidad: principal.cantidad ?? principal.crudo,
    unidad: principal.unidad ?? '',
    material: principal.material ?? principal.texto,
    detalle: renglones.length > 1 || avisos.length ? [...renglones.map((r) => r.texto), ...avisos].join('\n') : null,
  };
}

// Cuánto hay de cada producto (con cantidad) en una nota: clave -> { cantidad, base }.
function porProducto(nota) {
  const mapa = new Map();
  if (!nota) return mapa;
  for (const r of renglonesDe(nota).renglones) {
    const n = aNumero(r.cantidad);
    if (n === null) continue;
    const clave = claveDe(r);
    const actual = mapa.get(clave);
    mapa.set(clave, { cantidad: (actual?.cantidad ?? 0) + n, base: actual?.base ?? r });
  }
  return mapa;
}

// Un viaje cambió de "antes" a "despues" (null = se borró). Lo que el viaje bajó regresa al saldo y lo
// que subió se toma del saldo (sin pasarse de lo que queda). Un producto que el saldo no tiene y el
// viaje sube se deja como está: puede ser material nuevo o una corrección de nombre.
// Devuelve los renglones del saldo como quedan, o null si no cambia nada.
function saldoAjustado(saldo, antes, despues) {
  const viejo = porProducto(antes);
  const nuevo = porProducto(despues);
  const cambios = new Map();
  for (const clave of new Set([...viejo.keys(), ...nuevo.keys()])) {
    const delta = (viejo.get(clave)?.cantidad ?? 0) - (nuevo.get(clave)?.cantidad ?? 0);
    if (Math.abs(delta) > 1e-9) cambios.set(clave, { delta, base: viejo.get(clave)?.base ?? nuevo.get(clave).base });
  }
  if (!cambios.size) return null;
  const { renglones, avisos } = saldo ? renglonesDe(saldo) : { renglones: [], avisos: [] };
  const enSaldo = porProducto(saldo);
  let movio = false;
  const resultado = [];
  const vistos = new Set();
  for (const r of renglones) {
    const clave = claveDe(r);
    const c = aNumero(r.cantidad) === null ? null : cambios.get(clave);
    if (!c) { resultado.push(r); continue; }
    if (vistos.has(clave)) continue; // repetido: ya se sumó en el primero
    vistos.add(clave);
    const total = enSaldo.get(clave).cantidad;
    const queda = total + c.delta;
    if (queda < -1e-9) throw httpError(400, `En el saldo sólo quedan ${redondear(total)} de ${r.material}: no alcanza para subir el viaje`);
    movio = true;
    if (queda > 1e-9) resultado.push(igual(queda, aNumero(r.cantidad)) ? r : conCantidad(r, redondear(queda)));
  }
  for (const [clave, c] of cambios) {
    if (enSaldo.has(clave) || c.delta <= 0) continue;
    movio = true;
    resultado.push(conCantidad(c.base, redondear(c.delta))); // lo que bajó y el saldo no tenía
  }
  return movio ? { renglones: resultado, avisos } : null;
}

module.exports = { renglonesVentana, dividir, armar, saldoAjustado };
