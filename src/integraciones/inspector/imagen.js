// Imagen PNG de la cotización con aspecto de hoja de Excel sencilla (sin nombre ni logo).
// Se genera al momento con el mismo Chrome del robot; no se guardan archivos.
const puppeteer = require('puppeteer');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const dinero = (n) => `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const numero = (n) => Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 });

function html(c) {
  const fecha = new Date(c.creado_en.replace(' ', 'T')).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const filas = c.partidas.filter((p) => p.tipo !== 'flete' || p.precio > 0).map((p) => `
    <tr>
      <td>${esc(p.descripcion)}</td>
      <td class="n">${numero(p.cantidad)}</td>
      <td>${esc(p.unidad)}</td>
      <td class="n">${dinero(p.precio)}</td>
      <td class="n">${dinero(p.importe)}</td>
    </tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: #fff; font: 15px Calibri, Carlito, Arial, sans-serif; color: #000; }
    #hoja { display: inline-block; padding: 14px; }
    table { border-collapse: collapse; }
    td, th { border: 1px solid #b7b7b7; padding: 5px 10px; white-space: nowrap; }
    th { background: #e7e6e6; font-weight: bold; text-align: left; }
    .n { text-align: right; }
    .dato td { border-color: #d9d9d9; }
    .dato td:first-child { font-weight: bold; background: #f2f2f2; }
    .total td { font-weight: bold; color: #fff; background: #0088ff; }
    .sep td { border: none; height: 8px; }
  </style></head><body><div id="hoja"><table>
    <tr class="dato"><td>Cotización</td><td colspan="4">${esc(c.folio)}</td></tr>
    <tr class="dato"><td>Fecha</td><td colspan="4">${fecha}</td></tr>
    <tr class="dato"><td>Cliente</td><td colspan="4">${esc(c.cliente)}</td></tr>
    <tr class="dato"><td>Colonia</td><td colspan="4">${esc(c.colonia)}</td></tr>
    <tr class="sep"><td colspan="5"></td></tr>
    <tr><th>Descripción</th><th class="n">Cantidad</th><th>Unidad</th><th class="n">Precio</th><th class="n">Importe</th></tr>
    ${filas}
    <tr class="total"><td colspan="4" class="n">TOTAL</td><td class="n">${dinero(c.total)}</td></tr>
  </table></div></body></html>`;
}

// La orden de compra aprobada, con el mismo aspecto y sin precios.
function htmlOrden(o) {
  const fecha = new Date((o.aprobada_en ?? o.creado_en).replace(' ', 'T')).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const filas = o.renglones.map((r) => `
    <tr>
      <td class="n">${esc(r.cantidad)}</td>
      <td>${esc(r.unidad)}</td>
      <td>${esc(r.material)}</td>
    </tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: #fff; font: 15px Calibri, Carlito, Arial, sans-serif; color: #000; }
    #hoja { display: inline-block; padding: 14px; }
    table { border-collapse: collapse; }
    td, th { border: 1px solid #b7b7b7; padding: 5px 10px; white-space: nowrap; }
    th { background: #e7e6e6; font-weight: bold; text-align: left; }
    .n { text-align: right; }
    .dato td { border-color: #d9d9d9; }
    .dato td:first-child { font-weight: bold; background: #f2f2f2; }
    .total td { font-weight: bold; color: #fff; background: #2f9e5b; text-align: center; }
    .sep td { border: none; height: 8px; }
  </style></head><body><div id="hoja"><table>
    <tr class="dato"><td>Orden de compra</td><td colspan="2">${esc(o.folio)}</td></tr>
    <tr class="dato"><td>Fecha</td><td colspan="2">${fecha}</td></tr>
    <tr class="dato"><td>Sucursal</td><td colspan="2">${esc(o.sucursal)}</td></tr>
    <tr class="dato"><td>Solicitó</td><td colspan="2">${esc(o.solicitante)}</td></tr>
    <tr class="sep"><td colspan="3"></td></tr>
    <tr><th class="n">Cantidad</th><th>Unidad</th><th>Material</th></tr>
    ${filas}
    <tr class="total"><td colspan="3">APROBADA</td></tr>
  </table></div></body></html>`;
}

async function fotografiar(contenido) {
  const navegador = await puppeteer.launch({ headless: true });
  try {
    const page = await navegador.newPage();
    await page.setViewport({ width: 900, height: 600, deviceScaleFactor: 2 });
    await page.setContent(contenido, { waitUntil: 'load' });
    const hoja = await page.$('#hoja');
    return Buffer.from(await hoja.screenshot({ type: 'png' }));
  } finally {
    await navegador.close();
  }
}

const generarPNG = (cotizacion) => fotografiar(html(cotizacion));
const generarOrdenPNG = (orden) => fotografiar(htmlOrden(orden));

module.exports = { generarPNG, generarOrdenPNG };
