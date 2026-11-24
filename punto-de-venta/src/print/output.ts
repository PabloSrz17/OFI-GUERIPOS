import type { Tx } from '@/db/database';
import { getConnection } from '@/db/connection';
import { getSetting, setSetting } from '@/repos/settings';
import type { Seg, TicketLine } from './escpos';
import { clampCopies } from './local';

/** Impresora de tickets de la PC servidor (Preferencias → Tickets, D35). Se guarda en la base: vale para todas las PCs. */
export interface PrintSettings {
  /** Imprimir los tickets en la impresora de la PC servidor (si no, se abre el diálogo de impresión de esta PC). */
  enabled: boolean;
  printer: string;
  /** Caracteres por renglón: 48 o 42 (80 mm), 32 (58 mm). */
  columns: number;
  cut: boolean;
}

export const PRINT_KEY = 'printing.server';
export const DEFAULT_PRINT: PrintSettings = { enabled: false, printer: '', columns: 48, cut: true };

export function getPrintSettings(tx: Tx): PrintSettings {
  return { ...DEFAULT_PRINT, ...getSetting<Partial<PrintSettings>>(tx, PRINT_KEY, {}) };
}

export function savePrintSettings(tx: Tx, s: PrintSettings) {
  setSetting(tx, PRINT_KEY, s);
}

const joinSegs = (parts: Seg[]) => parts.map((p) => p.text).join('');

/** Junta espacios repetidos (también entre tramos) y quita los de las orillas, como hace el navegador. */
function cleanSegs(parts: Seg[]): Seg[] {
  const out: Seg[] = [];
  let prevSpace = true;
  for (const p of parts) {
    let t = '';
    for (const ch of p.text.replace(/ /g, ' ')) {
      const space = /\s/.test(ch);
      if (space && prevSpace) continue;
      t += space ? ' ' : ch;
      prevSpace = space;
    }
    if (t) out.push({ text: t, bold: p.bold });
  }
  const last = out[out.length - 1];
  if (last) last.text = last.text.replace(/ $/, '');
  return out.filter((p) => p.text);
}

/** Convierte el HTML del ticket (el subconjunto que usan los tickets) en renglones para la impresora térmica. */
export function htmlToLines(html: string): TicketLine[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: TicketLine[] = [];
  /** Tramos de texto de un elemento, separados en renglones por <br>; <b>/<strong> marcan negrita (D38). */
  const segLines = (el: Element): Seg[][] => {
    const lines: Seg[][] = [[]];
    const walk = (n: Node, bold: boolean) => {
      if (n.nodeName === 'BR') lines.push([]);
      else if (n.nodeType === Node.TEXT_NODE) lines[lines.length - 1].push({ text: n.textContent ?? '', bold });
      else n.childNodes.forEach((c) => walk(c, bold || n.nodeName === 'B' || n.nodeName === 'STRONG'));
    };
    el.childNodes.forEach((c) => walk(c, false));
    return lines.map(cleanSegs);
  };
  for (const el of Array.from(doc.body.children)) {
    const cls = el.classList;
    if (el.tagName === 'HR') out.push({ type: 'rule' });
    else if (el.tagName === 'BR') out.push({ type: 'text', text: '' });
    else if (cls.contains('row')) {
      const [l, r] = Array.from(el.children);
      const total = cls.contains('total');
      const leftParts = l ? segLines(l).flat() : [];
      const rightParts = r ? segLines(r).flat() : [];
      out.push({ type: 'row', left: joinSegs(leftParts), right: joinSegs(rightParts), leftParts, rightParts, bold: total || cls.contains('bold'), big: total || cls.contains('big'), tall: cls.contains('tall') });
    } else
      for (const parts of segLines(el))
        out.push({
          type: 'text',
          text: joinSegs(parts),
          parts,
          align: cls.contains('center') ? 'center' : cls.contains('right') ? 'right' : 'left',
          bold: cls.contains('bold') || cls.contains('item'),
          big: cls.contains('big'),
          tall: cls.contains('tall'),
        });
  }
  return out;
}

async function postJson(path: string, body: unknown) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' }).catch(() => {
    throw new Error('No hay conexión con el Servidor POS: no se pudo imprimir el ticket');
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`No se pudo imprimir el ticket: ${data.error ?? `error ${res.status}`}`);
}

/** Manda un ticket a la impresora de la PC servidor. */
export function printOnServer(s: PrintSettings, lines: TicketLine[], copies = 1) {
  return postJson('./api/print', { printer: s.printer, columns: s.columns, cut: s.cut, copies, lines });
}

/**
 * Imprime un ticket: en la impresora de la PC servidor si así está configurado y esta PC trabaja con el Servidor POS;
 * si no, con la impresión de esta PC (con diálogo, o directa en el acceso de mostrador). Cada copia es un trabajo aparte.
 */
export async function outputTicket(read: <T>(fn: (tx: Tx) => T) => Promise<T>, html: string, printHtml: (html: string) => void | Promise<void>, copies = 1) {
  const w = window as unknown as { __lastTicket?: string; __posNoPrint?: boolean };
  w.__lastTicket = html;
  const s = getConnection().mode === 'server' ? await read(getPrintSettings) : null;
  if (s?.enabled && s.printer) return printOnServer(s, htmlToLines(html), clampCopies(copies));
  for (let i = 0; i < clampCopies(copies); i++) await printHtml(html);
}
