import type { Tx } from '@/db/database';
import { paymentMethodLabel } from '@/domain/sale';
import { formatDateTime, formatMoney } from '@/lib/format';
import { getCut, type CutDetail } from '@/repos/cash';
import { getTicketSettings, printHtml, type TicketSettings } from '@/sales/ticket';
import { outputTicket } from '@/print/output';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (c: number) => formatMoney(c / 100);
const signed = (c: number) => formatMoney(c / 100, { signed: true });

/** Ticket de corte de 80 mm (diseño propio, D21): esperado, contado y diferencia por método; ingresos y retiros. */
export function cutTicketHtml(cut: CutDetail, t: TicketSettings) {
  const row = (l: string, r: string, cls = '') => `<div class="row ${cls}"><span>${l}</span><span>${r}</span></div>`;
  const lines = cut.lines
    .map((l) => {
      const diff = l.counted_cents - l.expected_cents;
      return [
        `<div class="bold item">${esc(paymentMethodLabel(l.method))}</div>`,
        row('&nbsp;&nbsp;Esperado', money(l.expected_cents)),
        row('&nbsp;&nbsp;Contado', money(l.counted_cents)),
        diff !== 0 ? row(`&nbsp;&nbsp;${diff < 0 ? 'Faltante' : 'Sobrante'}`, money(Math.abs(diff))) : '',
      ].join('');
    })
    .join('');
  const cash = cut.breakdown[0];
  const flows = cut.flows.map((f) => row(`${f.type === 'cash_in' ? 'Ingreso' : 'Retiro'}: ${esc(f.description)}`, signed(f.amount_cents))).join('');
  const diff = cut.difference_cents;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Corte ${cut.folio}</title><style>
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; padding: 4mm; width: 80mm; font: 12px/1.35 'Consolas', 'Courier New', monospace; color: #000; }
.center { text-align: center; } .bold { font-weight: 700; } .big { font-size: 15px; } .small { font-size: 11px; }
.row { display: flex; justify-content: space-between; gap: 8px; } .row span:last-child { white-space: nowrap; }
.item { margin-top: 4px; } .total { font-size: 15px; font-weight: 700; }
hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
</style></head><body>
<div class="center bold big">${esc(t.businessName)}</div>
<div class="center bold">CORTE DE CAJA</div>
<hr>
${row('Corte', `#${cut.folio}`, 'bold')}
${row('Caja', esc(cut.register_name))}
${row('Fecha', formatDateTime(new Date(cut.created_at)))}
${row('Realizado por', esc(cut.user_name))}
<hr>
<div class="bold">Efectivo</div>
${row('Al inicio', money(cash.start))}
${row('Ventas', signed(cash.sales))}
${cash.collections ? row('Cobros de crédito', signed(cash.collections)) : ''}
${row('Ingresos', signed(cash.cashIn))}
${row('Retiros', signed(cash.cashOut))}
${cash.deletions ? row('Ventas eliminadas', signed(cash.deletions)) : ''}
<hr>
${lines}
<hr>
${row('Total esperado', money(cut.expected_cents), 'bold')}
${row('Total contado', money(cut.counted_cents), 'bold')}
${row('Diferencia', diff === 0 ? 'Sin diferencia' : `${diff < 0 ? 'Faltan' : 'Sobran'} ${money(Math.abs(diff))}`, 'total')}
<hr>
${row('Retiro por corte', money(cut.withdrawn_cents), 'bold')}
${row('Restante en caja', money(cut.remaining_cents))}
${flows ? `<hr><div class="bold">Ingresos y retiros</div>${flows}` : ''}
${cut.comments ? `<hr><div>${esc(cut.comments).replace(/\n/g, '<br>')}</div>` : ''}
<br><br><div class="center">______________________________</div><div class="center small">Firma</div>
</body></html>`;
}

export async function printCutTicket(read: <T>(fn: (tx: Tx) => T) => Promise<T>, cutId: string) {
  const data = await read((tx) => ({ cut: getCut(tx, cutId), t: getTicketSettings(tx) }));
  if (!data.cut) throw new Error('El corte no existe');
  const html = cutTicketHtml(data.cut, data.t);
  await outputTicket(read, html, printHtml);
}
