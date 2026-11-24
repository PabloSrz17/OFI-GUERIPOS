import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuid } from './uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuid', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('funciona sin crypto.randomUUID (app abierta por IP desde otra PC)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    const ids = new Set(Array.from({ length: 500 }, () => uuid()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(V4);
  });

  it('usa crypto.randomUUID cuando existe', () => {
    expect(uuid()).toMatch(V4);
  });
});
