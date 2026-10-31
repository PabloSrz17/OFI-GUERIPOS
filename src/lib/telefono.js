// Teléfonos de México en el formato que usa WhatsApp: "52" + 10 dígitos (ej. 529811965122).

// Acepta "981 196 5122", "981-196-5122", "+52 1 981 196 5122", "5219811965122"…
function normalizar(texto) {
  let d = String(texto ?? '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('521')) d = d.slice(3);
  else if (d.length === 12 && d.startsWith('52')) d = d.slice(2);
  return d.length === 10 ? `52${d}` : null;
}

// Busca un teléfono escrito dentro de otro texto (en Pulpos se suele anotar en la dirección).
const EN_TEXTO = /(?<![\d])(?:\+?52[\s.-]?(?:1[\s.-]?)?)?\d{3}[\s.-]?\d{3}[\s.-]?\d{4}(?![\d])/;

function buscarEnTexto(texto) {
  const m = String(texto ?? '').match(EN_TEXTO);
  return m ? normalizar(m[0]) : null;
}

// 529811965122 -> "981 196 5122"
function formatear(telefono) {
  const d = String(telefono ?? '').replace(/^52/, '');
  return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : '';
}

module.exports = { normalizar, buscarEnTexto, formatear };
