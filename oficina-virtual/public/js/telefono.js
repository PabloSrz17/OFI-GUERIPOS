// Igual que src/lib/telefono.js: México, "52" + 10 dígitos.
export function normalizar(texto) {
  let d = String(texto ?? '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('521')) d = d.slice(3);
  else if (d.length === 12 && d.startsWith('52')) d = d.slice(2);
  return d.length === 10 ? `52${d}` : null;
}

export function formatear(telefono) {
  const d = String(telefono ?? '').replace(/^52/, '');
  return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : '';
}
