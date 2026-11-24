/**
 * Tickets para impresora térmica (D35). Un ticket es una lista de renglones sencillos; el navegador los saca del
 * HTML del ticket y el Servidor POS los convierte a ESC/POS (el lenguaje de casi todas las impresoras de tickets).
 * La negrita puede ir por tramos (D38): `parts` marca qué pedazos del texto van en negrita y el encoder activa
 * ESC E 1 justo antes y ESC E 0 justo después, sin cambiar espacios ni alineación.
 */
export interface Seg {
  text: string;
  bold?: boolean;
}

export type TicketLine =
  | { type: 'text'; text: string; parts?: Seg[]; align?: 'left' | 'center' | 'right'; bold?: boolean; big?: boolean; tall?: boolean }
  | { type: 'row'; left: string; right: string; leftParts?: Seg[]; rightParts?: Seg[]; bold?: boolean; big?: boolean; tall?: boolean }
  | { type: 'rule' };

export interface EscPosOptions {
  /** Caracteres por renglón: 48 (80 mm), 42 (80 mm, letra grande) o 32 (58 mm). */
  columns: number;
  /** Cortar el papel al final. */
  cut: boolean;
}

const ESC = 0x1b;
const GS = 0x1d;
/** Interlineado de los renglones normales (ESC 3 n): ~12 % más que el de fábrica (1/6"). */
const LINE_SPACING = 38;

// Página de códigos PC850 (ESC t 2): acentos, ñ, ¿ ¡ y °.
const CP850: Record<string, number> = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ü: 0x81, Ü: 0x9a,
  Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9, '¿': 0xa8, '¡': 0xad, '°': 0xf8, º: 0xa7, ª: 0xa6, '·': 0xfa,
};
const FALLBACK: Record<string, string> = { '“': '"', '”': '"', '‘': "'", '’': "'", '–': '-', '—': '-', '…': '...', ' ': ' ', '×': 'x' };

export function encodeText(s: string): number[] {
  const out: number[] = [];
  for (const ch of s.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x20 && c < 0x7f) out.push(c);
    else if (CP850[ch] !== undefined) out.push(CP850[ch]);
    else if (FALLBACK[ch]) out.push(...encodeText(FALLBACK[ch]));
    else {
      const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out.push(plain && plain.charCodeAt(0) < 0x7f ? plain.charCodeAt(0) : 0x3f);
    }
  }
  return out;
}

// ---------- Texto con negrita por carácter ----------
/** Un carácter y si va en negrita. */
interface SChar {
  c: string;
  b: boolean;
}
type Styled = SChar[];

const SPACE: SChar = { c: ' ', b: false };
const plainOf = (s: Styled) => s.map((x) => x.c).join('');
const spaces = (n: number): Styled => Array.from({ length: Math.max(0, n) }, () => SPACE);

function styled(parts: Seg[] | undefined, text: string, bold = false): Styled {
  const segs = parts && parts.length ? parts : [{ text, bold }];
  const out: Styled = [];
  for (const s of segs) for (const c of s.text.normalize('NFC')) out.push({ c: c === '\n' ? '\n' : /\s/.test(c) ? ' ' : c, b: !!(s.bold || bold) && !/\s/.test(c) });
  return out;
}

/** Parte en renglones de `width` sin cortar palabras (salvo las más largas que el renglón). */
function wrapStyled(text: Styled, width: number): Styled[] {
  const out: Styled[] = [];
  const paras: Styled[] = [[]];
  for (const ch of text) ch.c === '\n' ? paras.push([]) : paras[paras.length - 1].push(ch);
  for (const para of paras) {
    const words: Styled[] = [];
    let cur: Styled = [];
    for (const ch of para) {
      if (ch.c === ' ') {
        if (cur.length) words.push(cur);
        cur = [];
      } else cur.push(ch);
    }
    if (cur.length) words.push(cur);
    let line: Styled = [];
    for (let w of words) {
      while (w.length > width) {
        if (line.length) (out.push(line), (line = []));
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line.length) line = w;
      else if (line.length + 1 + w.length <= width) line = [...line, SPACE, ...w];
      else (out.push(line), (line = w));
    }
    out.push(line);
  }
  return out;
}

/** Izquierda y derecha en el mismo renglón; si no caben, la izquierda se parte y la derecha va en el último. */
function rowStyled(left: Styled, right: Styled, width: number): Styled[] {
  if (left.length + 1 + right.length <= width) return [[...left, ...spaces(width - left.length - right.length), ...right]];
  const lines = left.length ? wrapStyled(left, width) : [];
  const last = lines[lines.length - 1];
  if (last && last.length + 1 + right.length <= width) lines[lines.length - 1] = [...last, ...spaces(width - last.length - right.length), ...right];
  else lines.push([...spaces(width - right.length), ...right]);
  return lines;
}

function aligned(t: Styled, width: number, align: 'left' | 'center' | 'right' | undefined): Styled {
  if (align === 'center') return [...spaces(Math.floor((width - t.length) / 2)), ...t];
  if (align === 'right') return [...spaces(width - t.length), ...t];
  return t;
}

/** Margen a cada lado (D41), en caracteres normales: que nada quede pegado a la orilla del papel. */
export const marginFor = (columns: number) => (columns >= 42 ? 2 : 1);

/** Renglones ya acomodados (con su negrita por carácter y el margen izquierdo) de una línea del ticket. */
function layout(l: TicketLine, columns: number): { lines: Styled[]; big: boolean; tall: boolean } {
  const m = marginFor(columns);
  const content = columns - 2 * m;
  if (l.type === 'rule') return { lines: [[...spaces(m), ...Array.from({ length: content }, () => ({ c: '-', b: false }))]], big: false, tall: false };
  const big = !!l.big;
  const tall = !big && !!l.tall;
  // Letra grande: cada carácter ocupa dos; el margen también se cuenta en caracteres grandes.
  const width = big ? Math.floor(content / 2) : content;
  const pad = spaces(big ? Math.ceil(m / 2) : m);
  const rows =
    l.type === 'row'
      ? rowStyled(styled(l.leftParts, l.left, l.bold), styled(l.rightParts, l.right, l.bold), width)
      : wrapStyled(styled(l.parts, l.text, l.bold), width).map((t) => aligned(t, width, l.align));
  return { lines: rows.map((r) => (r.length ? [...pad, ...r] : r)), big, tall };
}

/**
 * Negrita efectiva del carácter i. Un espacio va en negrita solo si queda entre dos tramos en negrita
 * ("JUAN PEREZ"); así ESC E 1 abre justo antes del valor y ESC E 0 cierra justo después.
 */
function boldAt(row: Styled, i: number): boolean {
  if (row[i].c !== ' ') return row[i].b;
  const near = (step: number) => {
    for (let j = i + step; j >= 0 && j < row.length; j += step) if (row[j].c !== ' ') return row[j].b;
    return false;
  };
  return near(-1) && near(1);
}

// Versiones de solo texto (vista previa y pruebas).
export function wrap(text: string, width: number): string[] {
  return wrapStyled(styled(undefined, text), width).map(plainOf);
}
export function rowText(left: string, right: string, width: number): string[] {
  return rowStyled(styled(undefined, left), styled(undefined, right), width).map(plainOf);
}

/** Texto plano del ticket (para vista previa y pruebas). */
export function ticketText(lines: TicketLine[], columns: number): string {
  return lines.flatMap((l) => layout(l, columns).lines.map(plainOf)).join('\n');
}

/** Igual que ticketText, pero con la negrita marcada como **así** (pruebas). */
export function ticketMarkup(lines: TicketLine[], columns: number): string {
  const mark = (s: Styled) => {
    let out = '';
    let on = false;
    s.forEach((ch, i) => {
      const bb = boldAt(s, i);
      if (bb !== on) (out += '**'), (on = bb);
      out += ch.c;
    });
    return on ? out + '**' : out;
  };
  return lines.flatMap((l) => layout(l, columns).lines.map(mark)).join('\n');
}

/** Bytes ESC/POS listos para mandar en crudo a la impresora. */
export function escpos(lines: TicketLine[], opts: EscPosOptions): Uint8Array {
  const b: number[] = [ESC, 0x40, ESC, 0x74, 2]; // inicializar; página de códigos PC850
  const cols = Math.max(24, Math.min(64, Math.round(opts.columns)));
  for (const l of lines) {
    const { lines: rows, big, tall } = layout(l, cols);
    // La alineación ya va en los espacios: la impresora siempre a la izquierda.
    // big: doble ancho y alto (medio renglón); tall: doble alto, mismo ancho (no cambia la alineación).
    // Renglones normales con un poco más de aire (ESC 3 n); los de letra alta o grande, con el de fábrica (ESC 2).
    b.push(ESC, 0x61, 0, GS, 0x21, big ? 0x11 : tall ? 0x01 : 0, ESC, 0x45, 0, ...(big || tall ? [ESC, 0x32] : [ESC, 0x33, LINE_SPACING]));
    for (const row of rows) {
      let on = false;
      row.forEach((ch, i) => {
        const bb = boldAt(row, i);
        if (bb !== on) {
          b.push(ESC, 0x45, bb ? 1 : 0);
          on = bb;
        }
        b.push(...encodeText(ch.c));
      });
      if (on) b.push(ESC, 0x45, 0);
      b.push(0x0a);
    }
  }
  b.push(GS, 0x21, 0, ESC, 0x45, 0, ESC, 0x61, 0, ESC, 0x32, ESC, 0x64, 4); // avanzar 4 renglones para que el corte no se coma el pie
  if (opts.cut) b.push(GS, 0x56, 0x42, 0); // corte parcial
  return new Uint8Array(b);
}
