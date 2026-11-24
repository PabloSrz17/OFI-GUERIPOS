/** Periodos de los reportes (I-report-period-picker.png). Todo en hora local; los límites se pasan a ISO [desde, hasta). */
export type PeriodPreset = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'month' | 'last_month' | 'custom';
export type Granularity = 'day' | 'month';

export const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: '90d', label: 'Últimos 90 días' },
  { value: 'month', label: 'Mes actual' },
  { value: 'last_month', label: 'Mes pasado' },
  { value: 'custom', label: 'Fecha Personalizada' },
];

export interface Period {
  /** Inicio (incluido), ISO. */
  from: string;
  /** Fin (excluido), ISO. */
  to: string;
}

const day = (y: number, m: number, d: number) => new Date(y, m, d);
const addDays = (x: Date, n: number) => day(x.getFullYear(), x.getMonth(), x.getDate() + n);

/** "2026-11-23" (para inputs de fecha) ↔ Date local. */
export const toDateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function fromDateInput(s: string | null | undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  return m ? day(+m[1], +m[2] - 1, +m[3]) : null;
}

/** Límites del periodo. En "custom", `from` y `to` son fechas "aaaa-mm-dd" incluidas. */
export function periodBounds(preset: PeriodPreset, custom: { from?: string | null; to?: string | null } = {}, now = new Date()): Period {
  const today = day(now.getFullYear(), now.getMonth(), now.getDate());
  const y = today.getFullYear();
  const m = today.getMonth();
  let r: [Date, Date];
  switch (preset) {
    case 'today':
      r = [today, addDays(today, 1)];
      break;
    case 'yesterday':
      r = [addDays(today, -1), today];
      break;
    case '30d':
      r = [addDays(today, -29), addDays(today, 1)];
      break;
    case '90d':
      r = [addDays(today, -89), addDays(today, 1)];
      break;
    case 'month':
      r = [day(y, m, 1), day(y, m + 1, 1)];
      break;
    case 'last_month':
      r = [day(y, m - 1, 1), day(y, m, 1)];
      break;
    case 'custom': {
      const a = fromDateInput(custom.from) ?? addDays(today, -6);
      const b = fromDateInput(custom.to) ?? today;
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      r = [lo, addDays(hi, 1)];
      break;
    }
    default:
      r = [addDays(today, -6), addDays(today, 1)];
  }
  return { from: r[0].toISOString(), to: r[1].toISOString() };
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export interface Bucket {
  key: string;
  /** "21 de noviembre" / "noviembre 2026" (tabla). */
  label: string;
  /** "21 nov" / "nov 26" (eje del gráfico). */
  short: string;
}

export function bucketKey(iso: string, g: Granularity) {
  const d = new Date(iso);
  return g === 'day' ? toDateInput(d) : toDateInput(d).slice(0, 7);
}

/** Todos los días (o meses) del periodo, en orden, aunque no tengan ventas. */
export function periodBuckets(p: Period, g: Granularity): Bucket[] {
  const out: Bucket[] = [];
  const end = new Date(p.to);
  let d = new Date(p.from);
  d = g === 'day' ? day(d.getFullYear(), d.getMonth(), d.getDate()) : day(d.getFullYear(), d.getMonth(), 1);
  while (d < end && out.length < 400) {
    const key = g === 'day' ? toDateInput(d) : toDateInput(d).slice(0, 7);
    out.push(
      g === 'day'
        ? { key, label: `${d.getDate()} de ${MONTHS[d.getMonth()]}`, short: `${d.getDate()} ${SHORT[d.getMonth()]}` }
        : { key, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, short: `${SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` },
    );
    d = g === 'day' ? addDays(d, 1) : day(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return out;
}

/** "15 de noviembre - 21 de noviembre" (subtítulo del gráfico). */
export function periodLabel(p: Period) {
  const a = new Date(p.from);
  const b = new Date(new Date(p.to).getTime() - 1);
  const f = (d: Date) => `${d.getDate()} de ${MONTHS[d.getMonth()]}`;
  return toDateInput(a) === toDateInput(b) ? f(a) : `${f(a)} - ${f(b)}`;
}
