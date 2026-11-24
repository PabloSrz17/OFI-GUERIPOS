// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AccessStore, readCookie, type AccessData } from './auth';

function store() {
  let saved: AccessData | null = null;
  let now = new Date('2026-11-23T12:00:00Z').getTime();
  const s = new AccessStore(null, (d) => (saved = JSON.parse(JSON.stringify(d))), () => now);
  return { s, saved: () => saved!, advance: (ms: number) => (now += ms), reopen: () => new AccessStore(saved, () => {}, () => now) };
}

describe('acceso al servidor', () => {
  it('crea el primer usuario una sola vez y guarda solo el hash', () => {
    const { s, saved } = store();
    expect(s.configured).toBe(false);
    const token = s.setup('admin', 'secreta1');
    expect(s.session(token)).toBe('admin');
    expect(JSON.stringify(saved())).not.toContain('secreta1');
    expect(JSON.stringify(saved())).not.toContain(token);
    expect(() => s.setup('otro', 'secreta2')).toThrow('ya está configurado');
  });

  it('valida usuario y contraseña nuevos', () => {
    const { s } = store();
    expect(() => s.setup('a', 'secreta1')).toThrow('usuario');
    expect(() => s.setup('admin', '123')).toThrow('al menos 6');
  });

  it('inicia sesión (sin distinguir mayúsculas en el usuario) y la sesión sobrevive a reabrir', () => {
    const { s, reopen } = store();
    s.setup('admin', 'secreta1');
    const r = s.login('ADMIN ', 'secreta1', 'pc1');
    expect(r.user).toBe('admin');
    expect(reopen().session(r.token)).toBe('admin');
    expect(s.session('inventado')).toBeNull();
    s.logout(r.token);
    expect(s.session(r.token)).toBeNull();
  });

  it('rechaza contraseñas incorrectas y bloquea 5 minutos tras 5 intentos', () => {
    const { s, advance } = store();
    s.setup('admin', 'secreta1');
    for (let i = 0; i < 4; i++) expect(() => s.login('admin', 'mal', 'pc1')).toThrow('Usuario o contraseña incorrectos');
    expect(() => s.login('nadie', 'mal', 'pc1')).toThrow('Demasiados intentos');
    expect(() => s.login('admin', 'secreta1', 'pc1')).toThrow('Demasiados intentos');
    expect(s.login('admin', 'secreta1', 'pc2').user).toBe('admin');
    advance(5 * 60_000 + 1);
    expect(s.login('admin', 'secreta1', 'pc1').user).toBe('admin');
  });

  it('las sesiones vencen a los 30 días sin uso', () => {
    const { s, advance } = store();
    const t = s.setup('admin', 'secreta1');
    advance(29 * 86_400_000);
    expect(s.session(t)).toBe('admin');
    advance(29 * 86_400_000);
    expect(s.session(t)).toBe('admin');
    advance(31 * 86_400_000);
    expect(s.session(t)).toBeNull();
  });

  it('cambiar la contraseña cierra las demás sesiones', () => {
    const { s } = store();
    const a = s.setup('admin', 'secreta1');
    const b = s.login('admin', 'secreta1', 'pc2').token;
    expect(() => s.changePassword(a, 'mal', 'nueva123')).toThrow('actual no es correcta');
    s.changePassword(a, 'secreta1', 'nueva123');
    expect(s.session(a)).toBe('admin');
    expect(s.session(b)).toBeNull();
    expect(() => s.login('admin', 'secreta1', 'pc3')).toThrow('incorrectos');
    expect(s.login('admin', 'nueva123', 'pc3').user).toBe('admin');
  });

  it('lee la cookie de sesión', () => {
    expect(readCookie('a=1; pos_sesion=abc%2B; b=2')).toBe('abc+');
    expect(readCookie('a=1')).toBeUndefined();
  });
});
