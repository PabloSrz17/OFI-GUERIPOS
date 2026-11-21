import { formatMoney, formatMoneyShort, formatQuantity, formatRelativeDateTime } from './format';

describe('formatMoney', () => {
  it('formatea como en Pulpos', () => {
    expect(formatMoney(12951)).toBe('$12,951.00');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(-900)).toBe('-$900.00');
    expect(formatMoney(977, { signed: true })).toBe('+$977.00');
    expect(formatMoney(115398.1)).toBe('$115,398.10');
  });
});

describe('formatMoneyShort', () => {
  it('abrevia para ejes', () => {
    expect(formatMoneyShort(0)).toBe('$0');
    expect(formatMoneyShort(10000)).toBe('$10k');
    expect(formatMoneyShort(1500)).toBe('$1.5k');
    expect(formatMoneyShort(2_000_000)).toBe('$2M');
  });
});

describe('formatQuantity', () => {
  it('usa singular solo para 1 y -1', () => {
    expect(formatQuantity(1)).toBe('1 unidad');
    expect(formatQuantity(0)).toBe('0 unidades');
    expect(formatQuantity(-4)).toBe('-4 unidades');
    expect(formatQuantity(10, { singular: 'kg', plural: 'kg' })).toBe('10 kg');
  });
});

describe('formatRelativeDateTime', () => {
  const now = new Date(2026, 10, 21, 12, 0, 0);
  it('hoy, ayer y fechas anteriores', () => {
    expect(formatRelativeDateTime(new Date(2026, 10, 21, 10, 26), now)).toBe('Hoy a las 10:26');
    expect(formatRelativeDateTime(new Date(2026, 10, 20, 17, 7), now)).toBe('Ayer a las 17:07');
    expect(formatRelativeDateTime(new Date(2026, 10, 19, 17, 33, 1), now)).toBe('19/11/2026 17:33:01');
  });
});
