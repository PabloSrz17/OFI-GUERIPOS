import { describe, expect, it } from 'vitest';
import { backupDue } from './backup';

describe('backupDue', () => {
  const now = new Date('2026-11-23T12:00:00Z').getTime();
  it('no avisa sin ventas', () => expect(backupDue(null, false, now)).toBe(false));
  it('avisa si nunca se descargó', () => expect(backupDue(null, true, now)).toBe(true));
  it('no avisa antes de 24 horas', () => expect(backupDue('2026-11-22T13:00:00Z', true, now)).toBe(false));
  it('avisa después de 24 horas', () => expect(backupDue('2026-11-22T11:00:00Z', true, now)).toBe(true));
});
