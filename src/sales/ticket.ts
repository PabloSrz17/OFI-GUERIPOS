import type { Tx } from '@/db/database';
import { paymentMethodLabel, saleFolio } from '@/domain/sale';
import { formatMoney } from '@/lib/format';
import { getSale, type SaleDetail } from '@/repos/sales';
import { getSetting, setSetting } from '@/repos/settings';
import { getLocalPrint } from '@/print/local';
import { outputTicket } from '@/print/output';

/** Datos del encabezado y pie del ticket (Preferencias → Ticket). */
export interface TicketSettings {
  businessName: string;
  address: string;
  phone: string;
  rfc: string;
  footer: string;
}

export const TICKET_KEY = 'ticket.settings';
export const DEFAULT_TICKET: TicketSettings = { businessName: 'Mi Punto de Venta', address: '', phone: '', rfc: '', footer: '¡Gracias por su compra!' };

export function getTicketSettings(tx: Tx): TicketSettings {
  return { ...DEFAULT_TICKET, ...getSetting<Partial<TicketSettings>>(tx, TICKET_KEY, {}) };
}

export function saveTicketSettings(tx: Tx, s: TicketSettings) {
  setSetting(tx, TICKET_KEY, s);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (c: number) => formatMoney(c / 100);

const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const two = (n: number) => String(n).padStart(2, '0');
/** "23 NOV 2026" */
export const ticketDate = (d: Date) => `${two(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
/** "09:13:54 a.m." */
export const ticketTime = (d: Date) => `${two(d.getHours() % 12 || 12)}:${two(d.getMinutes())}:${two(d.getSeconds())} ${d.getHours() < 12 ? 'a.m.' : 'p.m.'}`;

/** Unidad como en el ticket: piezas sin unidad ("8 x $150.00"); medidas con ella ("5 kg x $50.00/kg", "1 Metro. x $550.00/Metro."). */
const TICKET_UNIT: Record<string, string> = { kg: 'kg', g: 'g', ml: 'ml', l: 'Litro.', m: 'Metro.', box: 'Caja.', pack: 'Paquete.', pair: 'Par.' };
/** Las medidas (kg, metros, litros…) cuentan como un artículo por renglón; las piezas, por cantidad. */
const MEASURED = new Set(['kg', 'g', 'l', 'ml', 'm']);
const qtyText = (q: number) => (Number.isInteger(q) ? String(q) : String(Number(q.toFixed(3))));

/** Celular sin la lada de México (+52), como en el ticket de referencia. */
const phoneText = (p: string | null) => (p ? p.replace(/^\+52/, '') : '');

/**
 * Ticket térmico de 80 mm (D38): misma distribución que el ticket de referencia del negocio. En negrita solo el folio,
 * el cliente y su celular, la dirección de entrega, cada material con su cantidad y el TOTAL (D41, sin cajero).
 */
export function ticketHtml(sale: SaleDetail, t: TicketSettings, opts: { copy?: boolean } = {}) {
  const row = (l: string, r: string, cls = '') => `<div class="row${cls ? ` ${cls}` : ''}"><span>${l}</span><span>${r}</span></div>`;
  const b = (s: string) => `<b>${s}</b>`;
  const created = new Date(sale.created_at);
  const items = sale.items
    .map((i) => {
      const unit = TICKET_UNIT[i.unit] ?? '';
      const qty = `${qtyText(i.quantity)}${unit ? ` ${unit}` : ''} x ${money(i.unit_price_cents)}${unit ? `/${unit}` : ''}`;
      const lines = [`<div class="item tall">${b(esc(i.name))}</div>`, row(b(esc(qty)), money(i.gross_cents), 'tall')];
      if (i.discount_cents > 0) lines.push(row(`&nbsp;&nbsp;Descuento${i.discount_label ? ` ${esc(i.discount_label)}` : ''}`, `-${money(i.discount_cents)}`));
      return lines.join('');
    })
    .join('<br>');
  const articles = sale.items.reduce((n, i) => n + (MEASURED.has(i.unit) ? 1 : i.quantity), 0);
  const client = sale.client_name ? b(esc(sale.client_name)) : 'Público General';
  // Forma de Entrega (D42). Las ventas anteriores no la tienen: con dirección se toma como envío (D41).
  const shipping = sale.delivery_method ? sale.delivery_method === 'shipping' : !!sale.client_address;
  const forma = sale.delivery_method === 'pickup' ? 'Recoge en Tienda' : shipping ? 'Envío a Domicilio' : '';
  const payment =
    sale.payment_method === 'credit'
      ? [row('A Crédito:', money(sale.credit_cents)), sale.due_date ? row('Vence:', ticketDate(new Date(sale.due_date))) : '']
      : sale.payment_method === 'cash'
        ? [row('Efectivo:', money(sale.received_cents ?? sale.total_cents)), row('Cambio:', money(sale.change_cents))]
        : [row(`${paymentMethodLabel(sale.payment_method)}:`, money(sale.total_cents))];
  const net = sale.total_cents - sale.tax_cents;
  const taxLabel = net > 0 && Math.abs(sale.tax_cents / net - 0.16) < 0.005 ? 'IVA 16% (incluido)' : 'Impuestos (incluidos)';
  const header = [
    t.address && `<div class="center">${esc(t.address).replace(/\n/g, '<br>')}</div>`,
    t.phone && `<div class="center">Tel. ${esc(t.phone)}</div>`,
    t.rfc && `<div class="center">RFC ${esc(t.rfc)}</div>`,
  ]
    .filter(Boolean)
    .join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${saleFolio(sale.folio)}</title><style>
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; padding: 3mm 5mm; width: 80mm; font: 400 15px/1.5 'Consolas', 'Courier New', monospace; color: #000; }
b { font-weight: 800; }
.center { text-align: center; } .right { text-align: right; } .tall { font-size: 19px; } .big { font-size: 26px; line-height: 1.3; } .small { font-size: 13px; }
.row { display: flex; justify-content: space-between; gap: 8px; } .row span:first-child { min-width: 0; overflow-wrap: anywhere; } .row span:last-child { white-space: nowrap; text-align: right; }
.item { margin-top: 4px; overflow-wrap: anywhere; }
hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
</style></head><body>
${header ? `${header}<hr>` : ''}
${row(ticketDate(created), ticketTime(created))}
${row(sale.mode === 'order' ? 'Pedido' : 'Venta', b(saleFolio(sale.folio)), 'big')}
${opts.copy ? '<div class="center">REIMPRESIÓN</div>' : ''}
<hr>
${row('Cliente:', client)}
${sale.client_name && sale.client_phone ? row('Celular:', b(esc(phoneText(sale.client_phone)))) : ''}
${forma ? row('Forma de Entrega:', forma) : ''}
${shipping && sale.client_address ? `<br><div>Dirección de Entrega:</div><div>${b(esc(sale.client_address))}</div>` : ''}
<hr>
${row('ITEM', 'PRECIO')}
<hr>
${items}
<hr>
${row(`Número de artículos: ${qtyText(articles)}`, `Subtotal: ${money(sale.subtotal_cents)}`)}
${sale.discount_cents > 0 ? `<div class="right">Descuentos: -${money(sale.discount_cents)}</div>` : ''}
${sale.taxes_removed_cents > 0 ? `<div class="right">Impuestos removidos: -${money(sale.taxes_removed_cents)}</div>` : ''}
<hr>
${row(b('TOTAL'), b(money(sale.total_cents)), 'big')}
${sale.tax_cents > 0 ? `<div class="right">${taxLabel}: ${money(sale.tax_cents)}</div>` : ''}
<hr>
<div class="center">${sale.delivery_status === 'pending' ? 'Entrega Pendiente' : 'Entregado'}</div>
<hr>
${payment.join('')}
${sale.balance_cents > 0 && sale.payment_method !== 'credit' ? row('Saldo pendiente:', money(sale.balance_cents)) : ''}
<hr>
${sale.note ? `<div>${esc(sale.note).replace(/\n/g, '<br>')}</div><hr>` : ''}
${t.footer ? `<div class="center">${esc(t.footer).replace(/\n/g, '<br>')}</div>` : ''}
</body></html>`;
}

/**
 * Imprime HTML en un iframe oculto. Termina cuando el navegador ya mandó el trabajo, para que las copias salgan
 * una tras otra (con el acceso de mostrador no hay diálogo: cada copia es un trabajo y la impresora corta cada una).
 */
export function printHtml(html: string): Promise<void> {
  // Las pruebas automáticas desactivan el diálogo de impresión.
  if ((window as unknown as { __posNoPrint?: boolean }).__posNoPrint) return Promise.resolve();
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  const w = frame.contentWindow!;
  return new Promise((done) =>
    setTimeout(() => {
      w.focus();
      w.print();
      setTimeout(() => {
        frame.remove();
        done();
      }, 500);
    }, 50),
  );
}

/** Lee la venta y la imprime. */
export async function printSaleTicket(read: <T>(fn: (tx: Tx) => T) => Promise<T>, saleId: string, opts: { copy?: boolean; checkout?: boolean } = {}) {
  const data = await read((tx) => ({ sale: getSale(tx, saleId), t: getTicketSettings(tx), copies: opts.checkout ? getLocalPrint().copies : 1 }));
  if (!data.sale) throw new Error('La venta no existe');
  const html = ticketHtml(data.sale, data.t, opts);
  await outputTicket(read, html, printHtml, data.copies);
}
