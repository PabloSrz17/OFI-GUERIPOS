/**
 * Acceso al Servidor POS (D33): usuario y contraseña, sesiones con cookie y bloqueo por intentos fallidos.
 * Las contraseñas se guardan solo como hash scrypt con sal; las sesiones, como hash SHA-256 del token.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface StoredUser {
  name: string;
  salt: string;
  hash: string;
  created_at: string;
}
interface StoredSession {
  token_hash: string;
  user: string;
  created_at: string;
  last_seen: string;
}
export interface AccessData {
  users: StoredUser[];
  sessions: StoredSession[];
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const SESSION_DAYS = 30;
const DAY = 86_400_000;
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60_000;
const SCRYPT = { N: 16384, r: 8, p: 1 };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64, SCRYPT).toString('hex') };
}
function checkPassword(user: StoredUser, password: string) {
  const a = Buffer.from(hashPassword(password, user.salt).hash, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
export function newUser(name: string, password: string, now = new Date()): StoredUser {
  return { name, ...hashPassword(password), created_at: now.toISOString() };
}

export function validateNewCredentials(name: string, password: string) {
  if (!/^[\w.-]{3,32}$/.test(name)) throw new AuthError('El usuario debe tener de 3 a 32 letras, números, punto, guion o guion bajo');
  if (password.length < 6) throw new AuthError('La contraseña debe tener al menos 6 caracteres');
  if (password.length > 200) throw new AuthError('La contraseña es demasiado larga');
}

/** Usuarios y sesiones. `save` se llama después de cada cambio (en el servidor, escribe `datos/acceso.json`). */
export class AccessStore {
  private data: AccessData;
  private fails = new Map<string, { count: number; until: number }>();

  constructor(
    data: AccessData | null,
    private save: (data: AccessData) => void,
    private now = () => Date.now(),
  ) {
    this.data = { users: data?.users ?? [], sessions: data?.sessions ?? [] };
    this.prune();
  }

  get configured() {
    return this.data.users.length > 0;
  }

  private persist() {
    this.save(this.data);
  }
  private prune() {
    const limit = this.now() - SESSION_DAYS * DAY;
    this.data.sessions = this.data.sessions.filter((s) => new Date(s.last_seen).getTime() > limit && this.data.users.some((u) => u.name === s.user));
  }
  private issue(user: string) {
    const token = randomBytes(32).toString('base64url');
    const at = new Date(this.now()).toISOString();
    this.data.sessions.push({ token_hash: sha256(token), user, created_at: at, last_seen: at });
    this.persist();
    return token;
  }

  /** Primer usuario (solo cuando no hay ninguno). */
  setup(name: string, password: string) {
    if (this.configured) throw new AuthError('El acceso ya está configurado', 409);
    validateNewCredentials(name, password);
    this.data.users.push(newUser(name, password, new Date(this.now())));
    return this.issue(name);
  }

  /** Importa usuarios ya preparados (acceso inicial de la carpeta del servidor), solo si no hay ninguno. */
  importUsers(users: StoredUser[]) {
    if (this.configured || !users.length) return false;
    this.data.users = users.map((u) => ({ name: u.name, salt: u.salt, hash: u.hash, created_at: u.created_at }));
    this.persist();
    return true;
  }

  login(name: string, password: string, client: string) {
    const f = this.fails.get(client);
    if (f && f.until > this.now()) throw new AuthError(`Demasiados intentos. Espera ${Math.ceil((f.until - this.now()) / 60_000)} min e intenta de nuevo.`, 429);
    const user = this.data.users.find((u) => u.name.toLowerCase() === name.trim().toLowerCase());
    // Siempre se calcula un hash, exista o no el usuario, para no revelar cuáles existen por el tiempo de respuesta.
    const ok = user ? checkPassword(user, password) : (hashPassword(password), false);
    if (!ok || !user) {
      const count = (f && f.until <= this.now() && f.count >= MAX_FAILS ? 0 : (f?.count ?? 0)) + 1;
      this.fails.set(client, { count, until: count >= MAX_FAILS ? this.now() + LOCK_MS : 0 });
      throw new AuthError(count >= MAX_FAILS ? 'Demasiados intentos. Espera 5 min e intenta de nuevo.' : 'Usuario o contraseña incorrectos', count >= MAX_FAILS ? 429 : 401);
    }
    this.fails.delete(client);
    return { token: this.issue(user.name), user: user.name };
  }

  /** Usuario de la sesión, o null. Actualiza "visto por última vez" como mucho una vez por hora. */
  session(token: string | undefined): string | null {
    if (!token) return null;
    const h = sha256(token);
    const s = this.data.sessions.find((x) => x.token_hash === h);
    if (!s) return null;
    const now = this.now();
    if (now - new Date(s.last_seen).getTime() > SESSION_DAYS * DAY) {
      this.logout(token);
      return null;
    }
    if (now - new Date(s.last_seen).getTime() > 3_600_000) {
      s.last_seen = new Date(now).toISOString();
      this.persist();
    }
    return s.user;
  }

  logout(token: string | undefined) {
    if (!token) return;
    const h = sha256(token);
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => s.token_hash !== h);
    if (this.data.sessions.length !== before) this.persist();
  }

  /** Cambia la contraseña y cierra las demás sesiones de ese usuario. */
  changePassword(token: string, current: string, next: string) {
    const name = this.session(token);
    const user = this.data.users.find((u) => u.name === name);
    if (!user) throw new AuthError('Sesión requerida', 401);
    if (!checkPassword(user, current)) throw new AuthError('La contraseña actual no es correcta');
    validateNewCredentials(user.name, next);
    Object.assign(user, hashPassword(next));
    const keep = sha256(token);
    this.data.sessions = this.data.sessions.filter((s) => s.user !== user.name || s.token_hash === keep);
    this.persist();
  }
}

/** Lee la cookie de sesión de un encabezado Cookie. */
export const SESSION_COOKIE = 'pos_sesion';
export function readCookie(header: string | undefined, name = SESSION_COOKIE) {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}
export const sessionCookie = (token: string) => `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86_400}`;
export const clearCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
