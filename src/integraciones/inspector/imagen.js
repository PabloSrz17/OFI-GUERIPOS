// Imagen PNG de la cotización con aspecto de hoja de Excel sencilla (sin nombre ni logo).
// Se genera al momento con el mismo Chrome del robot; no se guardan archivos.
const puppeteer = require('puppeteer');
const { aNumero } = require('./cotizador');

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

// La tarjeta "por autorizar" como se ve en la Oficina, para el grupo del equipo (no va a clientes).
function htmlTarjeta(s) {
  const b = s.borrador;
  const partidas = b.partidas.filter((p) => p.tipo !== 'flete' || p.precio > 0);
  const importe = (p) => (p.precio == null || !(aNumero(p.cantidad) > 0) ? null : Math.round(aNumero(p.cantidad) * p.precio * 100) / 100);
  const faltan = partidas.some((p) => importe(p) == null);
  const total = partidas.reduce((t, p) => t + (importe(p) ?? 0), 0);
  const filas = partidas.map((p) => `
    <tr>
      <td class="n">${esc(p.cantidad ?? '?')}</td>
      <td>${esc(p.unidad)}</td>
      <td>${esc(p.descripcion)}</td>
      <td class="n">${p.precio == null ? '<span class="falta">falta precio</span>' : dinero(p.precio)}</td>
      <td class="n">${importe(p) == null ? '—' : dinero(importe(p))}</td>
    </tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: #eef1f5; font: 15px "Segoe UI", Arial, sans-serif; color: #1d2733; }
    #hoja { display: inline-block; margin: 12px; padding: 16px 18px; background: #fff; border-radius: 12px; border-left: 6px solid #f0a020; box-shadow: 0 2px 8px #0002; }
    .titulo { font-size: 12px; font-weight: bold; color: #b06d00; text-transform: uppercase; letter-spacing: .05em; }
    h1 { font-size: 20px; margin: 2px 0 4px; }
    .datos { color: #556; margin-bottom: 10px; }
    table { border-collapse: collapse; }
    td, th { border-bottom: 1px solid #e3e6ea; padding: 6px 10px; white-space: nowrap; text-align: left; }
    th { font-size: 12px; color: #667; }
    .n { text-align: right; }
    .falta { color: #c62828; font-weight: bold; }
    .total td { border: none; font-weight: bold; font-size: 17px; padding-top: 10px; }
  </style></head><body><div id="hoja">
    <div class="titulo">Cotización por autorizar · #${s.id}</div>
    <h1>${esc(b.cliente)}</h1>
    <div class="datos">Colonia: ${esc(b.colonia || '—')} · Pago: ${esc(b.metodo_pago || '—')}</div>
    <table>
      <tr><th class="n">Cant.</th><th>Unidad</th><th>Material</th><th class="n">Precio</th><th class="n">Importe</th></tr>
      ${filas}
      <tr class="total"><td colspan="4" class="n">TOTAL${faltan ? ' (sin los que faltan)' : ''}</td><td class="n">${dinero(total)}</td></tr>
    </table>
  </div></body></html>`;
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
const generarTarjetaPNG = (solicitud) => fotografiar(htmlTarjeta(solicitud));

module.exports = { generarPNG, generarOrdenPNG, generarTarjetaPNG };
