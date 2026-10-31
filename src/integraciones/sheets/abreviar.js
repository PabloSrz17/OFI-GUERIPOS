// Convierte los productos de una nota al formato corto de la hoja de reparto:
//   cemento (columna D): "8 MAYA", "15 APASCO"
//   lo demás (E en adelante): "1M POLVO", ".5M GRAVA", "6 B POLVO", "13 B 10" (block), "10 V 3/8" (varilla)
// Lo que no se sabe abreviar se escribe con su nombre en mayúsculas.

const UNIDADES = /^(m³|m3|bulto|bultos|bolsa|bolsas|pz|viaje|viajes|kg|ton)$/i;
const RUIDO = /\b(25\s*kg|50\s*kg|cemex|por pieza|pieza|pza)\b/gi;

// 0.5 -> ".5", 1.5 -> "1.5", 7 -> "7"
const numero = (n) => (n === '' || Number.isNaN(Number(n)) ? String(n) : String(Number(n)).replace(/^0\./, '.')); // "1/2" se queda como texto

// "4 × CEMENTO MAYA 25 KG CEMEX" | "7 m³ POLVO" | "10 bulto CEMENTO"
function leerLinea(linea) {
  const m = String(linea).trim().match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)\s*(?:[×x]\s*)?(.*)$/i);
  if (!m) return null;
  let resto = m[2].trim();
  let unidad = null;
  const [primera, ...demas] = resto.split(/\s+/);
  if (UNIDADES.test(primera) && demas.length) {
    unidad = primera.toLowerCase().replace('m3', 'm³').replace(/s$/, '');
    resto = demas.join(' ');
  }
  return { cantidad: m[1].includes('/') ? m[1] : Number(m[1].replace(',', '.')), unidad, nombre: resto };
}

// Partidas de la nota: si hay detalle (varios productos) se usan sus líneas; si no, el producto principal.
function partidas(nota) {
  if (nota.detalle) {
    // Un renglón sin cantidad ("CAL") también va; el aviso de revisar en Pulpos, no.
    return nota.detalle.split('\n')
      .filter((l) => l.trim() && !l.startsWith('⚠️'))
      .map((l) => leerLinea(l) ?? { cantidad: '', unidad: null, nombre: l.trim() });
  }
  return [{ cantidad: nota.cantidad, unidad: nota.unidad, nombre: String(nota.material).replace(/\s*\(\+\d+\)$/, '') }];
}

function abreviar({ cantidad, unidad, nombre }) {
  const n = numero(cantidad);
  // En la hoja se sigue anotando corto: "10 B POLVO C/B".
  const t = nombre.toUpperCase().replace(RUIDO, '').replace(/\bCON BOLSA\b/g, 'C/B').replace(/\s+/g, ' ').trim();

  if (/SERVICIO|ENV[IÍ]O|FLETE/.test(t)) return null; // el envío no es material
  const marca = t.match(/\b(MAYA|APASCO|HOLCIM|TOLTECA|MOCTEZUMA)\b/);
  if (marca || /\bCEMENTO\b/.test(t)) return { tipo: 'cemento', texto: `${n} ${marca ? marca[1] : 'CEMENTO'}` };

  const block = t.match(/\bBLOCK\b.*?\b(10|12|15|20)\b/) ?? t.match(/\bBLOCK\b.*?\b(\d{2})X\d{2}X\d{2}/);
  if (block) return { tipo: 'otro', texto: `${n} B ${block[1]}` };
  const varilla = t.match(/\bVARILLA\b.*?(\d\/\d)/);
  if (varilla) return { tipo: 'otro', texto: `${n} V ${varilla[1]}` };

  const material = t.replace(/\b(POR M3|POR M³|M3|M³|POR METRO|METROS? CUBICOS?|POR BOLSA|BOLSAS?|BULTOS?)(?=\s|$)/g, '').replace(/\s+/g, ' ').trim();
  if (unidad === 'm³' || /\b(M3|M³|POR METRO)\b/.test(t)) return { tipo: 'otro', texto: `${n}M ${material}` };
  if (/\b(POR BOLSA|BOLSAS?|BULTOS?)\b/.test(t) || (/^(bulto|bolsa)/i.test(unidad ?? '') && material)) return { tipo: 'otro', texto: `${n} B ${material}` };
  return { tipo: 'otro', texto: `${n} ${material || t}` };
}

// -> { cemento: ["8 MAYA"], otros: ["1M POLVO", ".5M GRAVA"] }
function materialesDeNota(nota) {
  const cemento = [];
  const otros = [];
  for (const p of partidas(nota)) {
    const a = abreviar(p);
    if (a) (a.tipo === 'cemento' ? cemento : otros).push(a.texto.trim());
  }
  return { cemento, otros };
}

module.exports = { materialesDeNota, abreviar, leerLinea };
