import type { Tx } from '@/db/database';
import { paymentMethodLabel, saleFolio } from '@/domain/sale';
import { formatDateTime, formatMoney } from '@/lib/format';
import { getCollection, type CollectionDetail } from '@/repos/collections';
import { getTicketSettings, printHtml, type TicketSettings } from '@/sales/ticket';
import { outputTicket } from '@/print/output';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (c: number) => formatMoney(c / 100);

/** Ticket de cobro de 80 mm (diseño propio, D25): cliente, ventas abonadas con su saldo y deuda restante. */
export function collectionTicketHtml(c: CollectionDetail, t: TicketSettings) {
  const row = (l: string, r: string, cls = '') => `<div class="row ${cls}"><span>${l}</span><span>${r}</span></div>`;
  const header = [t.address, t.phone && `Tel. ${t.phone}`, t.rfc && `RFC ${t.rfc}`].filter(Boolean).map((l) => `<div class="center small">${esc(l as string)}</div>`).join('');
  const sales = c.sales.map((s) => [row(`Venta ${saleFolio(s.folio)}`, money(s.amount_cents)), row('&nbsp;&nbsp;Saldo', s.balance_cents > 0 ? money(s.balance_cents) : 'Pagada', 'small')].join('')).join('');
  const cash = c.method === 'cash' && c.received_cents !== null ? row('Recibido', money(c.received_cents)) + row('Cambio', money(c.change_cents)) : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cobro ${c.folio}</title><style>
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; padding: 4mm; width: 80mm; font: 12px/1.35 'Consolas', 'Courier New', monospace; color: #000; }
.center { text-align: center; } .bold { font-weight: 700; } .big { font-size: 15px; } .small { font-size: 11px; }
.row { display: flex; justify-content: space-between; gap: 8px; } .row span:last-child { white-space: nowrap; }
.total { font-size: 15px; font-weight: 700; }
hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
</style></head><body>
<div class="center bold big">${esc(t.businessName)}</div>
${header}
<div class="center bold">COMPROBANTE DE COBRO</div>
${c.canceled_at ? '<div class="center bold">*** CANCELADO ***</div>' : ''}
<hr>
${row('Cobro', `#${c.folio}`, 'bold')}
${row('Fecha', formatDateTime(new Date(c.created_at)))}
${row('Caja', esc(c.register_name))}
${row('Atendió', esc(c.user_name))}
${c.client_name ? row('Cliente', esc(c.client_name)) : ''}
<hr>
${sales}
<hr>
${row('Total cobrado', money(c.amount_cents), 'total')}
${row('Forma de pago', esc(paymentMethodLabel(c.method)))}
${cash}
<hr>
${row('Deuda restante', money(c.remaining_debt_cents), 'bold')}
${t.footer ? `<hr><div class="center">${esc(t.footer).replace(/\n/g, '<br>')}</div>` : ''}
</body></html>`;
}

export async function printCollectionTicket(read: <T>(fn: (tx: Tx) => T) => Promise<T>, id: string) {
  const data = await read((tx) => ({ c: getCollection(tx, id), t: getTicketSettings(tx) }));
  if (!data.c) throw new Error('El cobro no existe');
  const html = collectionTicketHtml(data.c, data.t);
  await outputTicket(read, html, printHtml);
}
