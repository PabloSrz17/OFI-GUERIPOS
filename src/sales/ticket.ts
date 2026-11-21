import type { Tx } from '@/db/database';
import { quantityUnit } from '@/domain/catalog';
import { paymentMethodLabel, saleFolio } from '@/domain/sale';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { getSale, type SaleDetail } from '@/repos/sales';
import { getSetting, setSetting } from '@/repos/settings';

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

/** Ticket térmico de 80 mm (≈ 72 mm imprimibles, 42 caracteres en monoespaciada). */
export function ticketHtml(sale: SaleDetail, t: TicketSettings, opts: { copy?: boolean } = {}) {
  const row = (l: string, r: string, cls = '') => `<div class="row ${cls}"><span>${l}</span><span>${r}</span></div>`;
  const items = sale.items
    .map((i) => {
      const qty = formatQuantity(i.quantity, quantityUnit(i.unit));
      const lines = [`<div class="item">${esc(i.name)}</div>`, row(`${esc(qty)} x ${money(i.unit_price_cents)}`, money(i.gross_cents))];
      if (i.discount_cents > 0) lines.push(row(`&nbsp;&nbsp;Descuento${i.discount_label ? ` ${esc(i.discount_label)}` : ''}`, `-${money(i.discount_cents)}`));
      return lines.join('');
    })
    .join('');
  const payment =
    sale.payment_method === 'credit'
      ? [row('A Crédito', money(sale.credit_cents)), sale.due_date ? `<div class="center small">Vence el ${formatDateTime(new Date(sale.due_date)).slice(0, 10)}</div>` : '']
      : sale.payment_method === 'cash'
        ? [row('Efectivo', money(sale.received_cents ?? sale.total_cents)), row('Cambio', money(sale.change_cents))]
        : [row(paymentMethodLabel(sale.payment_method), money(sale.total_cents))];
  const header = [
    `<div class="center bold big">${esc(t.businessName)}</div>`,
    t.address && `<div class="center">${esc(t.address).replace(/\n/g, '<br>')}</div>`,
    t.phone && `<div class="center">Tel. ${esc(t.phone)}</div>`,
    t.rfc && `<div class="center">RFC ${esc(t.rfc)}</div>`,
  ]
    .filter(Boolean)
    .join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${saleFolio(sale.folio)}</title><style>
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; padding: 4mm; width: 80mm; font: 12px/1.35 'Consolas', 'Courier New', monospace; color: #000; }
.center { text-align: center; } .bold { font-weight: 700; } .big { font-size: 15px; } .small { font-size: 11px; }
.row { display: flex; justify-content: space-between; gap: 8px; } .row span:last-child { white-space: nowrap; }
.item { margin-top: 4px; } .total { font-size: 15px; font-weight: 700; }
hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
</style></head><body>
${header}
<hr>
${row(sale.mode === 'order' ? 'Pedido' : 'Venta', saleFolio(sale.folio), 'bold')}
${row('Fecha', formatDateTime(new Date(sale.created_at)))}
${row('Cajero', esc(sale.user_name))}
${sale.client_name ? row('Cliente', esc(sale.client_name)) : ''}
${opts.copy ? '<div class="center bold">REIMPRESIÓN</div>' : ''}
<hr>
${items}
<hr>
${row('Subtotal', money(sale.subtotal_cents))}
${sale.discount_cents > 0 ? row('Descuentos', `-${money(sale.discount_cents)}`) : ''}
${sale.taxes_removed_cents > 0 ? row('Impuestos removidos', `-${money(sale.taxes_removed_cents)}`) : ''}
${row('TOTAL', money(sale.total_cents), 'total')}
${sale.tax_cents > 0 ? `<div class="small">Incluye impuestos por ${money(sale.tax_cents)}</div>` : ''}
<hr>
${payment.join('')}
${sale.balance_cents > 0 && sale.payment_method !== 'credit' ? row('Saldo pendiente', money(sale.balance_cents)) : ''}
${sale.delivery_status === 'pending' ? '<div class="center bold">PRODUCTOS POR ENTREGAR</div>' : ''}
${sale.note ? `<hr><div>${esc(sale.note).replace(/\n/g, '<br>')}</div>` : ''}
${t.footer ? `<hr><div class="center">${esc(t.footer).replace(/\n/g, '<br>')}</div>` : ''}
</body></html>`;
}

/** Imprime HTML en un iframe oculto (la impresora térmica se elige en el diálogo del sistema la primera vez). */
export function printHtml(html: string) {
  // Las pruebas automáticas desactivan el diálogo de impresión.
  if ((window as unknown as { __posNoPrint?: boolean }).__posNoPrint) return;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  const w = frame.contentWindow!;
  const cleanup = () => setTimeout(() => frame.remove(), 500);
  w.addEventListener('afterprint', cleanup);
  setTimeout(() => {
    w.focus();
    w.print();
    cleanup();
  }, 50);
}

/** Lee la venta y la imprime. */
export async function printSaleTicket(read: <T>(fn: (tx: Tx) => T) => Promise<T>, saleId: string, opts: { copy?: boolean } = {}) {
  const data = await read((tx) => ({ sale: getSale(tx, saleId), t: getTicketSettings(tx) }));
  if (!data.sale) throw new Error('La venta no existe');
  const html = ticketHtml(data.sale, data.t, opts);
  (window as unknown as { __lastTicket?: string }).__lastTicket = html;
  printHtml(html);
}
