// Formatos observados en Pulpos (reference/pulpos/design-system.md §6).

const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** $12,951.00 · -$900.00 · con signo: +$977.00 */
export function formatMoney(value: number, opts: { signed?: boolean } = {}): string {
  const abs = money.format(Math.abs(value));
  if (value < 0) return `-$${abs}`;
  if (opts.signed && value > 0) return `+$${abs}`;
  return `$${abs}`;
}

/** Abreviado para ejes de gráficos: $0, $10k, $1.5M */
export function formatMoneyShort(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${trim(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}$${trim(abs / 1_000)}k`;
  return `${sign}$${trim(abs)}`;
}

function trim(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

/** "1 unidad", "0 unidades", "-4 unidades", "10 kg" */
export function formatQuantity(qty: number, unit: { singular: string; plural: string } = { singular: 'unidad', plural: 'unidades' }): string {
  const n = Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(3)));
  return `${n} ${Math.abs(qty) === 1 ? unit.singular : unit.plural}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Hoy a las 10:26", "Ayer a las 17:07", o "19/11/2026 17:33:01" */
export function formatRelativeDateTime(date: Date, now: Date = new Date()): string {
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay(date, now)) return `Hoy a las ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `Ayer a las ${time}`;
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${time}:${pad(date.getSeconds())}`;
}

/** "10/11/2026 13:05:26" (tablas de movimientos). */
export function formatDateTime(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
