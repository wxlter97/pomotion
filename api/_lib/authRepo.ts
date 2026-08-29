/**
 * Acceso a las tablas de auth (`users`, `auth_sessions`, `oauth_state`).
 * Separado del `Store` de dominio a propósito: esto es infraestructura de
 * login, no tareas/sesiones.
 */
import crypto from 'node:crypto';
import type { Row } from '@libsql/client';
import { getDb } from './db.js';

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  pictureUrl: string | null;
  googleSub: string;
  approvedLogin: boolean;
  isAdmin: boolean;
  createdAt: string;
  lastSeenAt: string | null;
};

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 min — vida de la ida/vuelta a Google

function str(v: unknown): string {
  return String(v);
}
function nullableStr(v: unknown): string | null {
  return v == null ? null : String(v);
}

function rowToUser(r: Row): UserRow {
  return {
    id: str(r.id),
    email: str(r.email),
    name: nullableStr(r.name),
    pictureUrl: nullableStr(r.picture_url),
    googleSub: str(r.google_sub),
    approvedLogin: Number(r.approved_login) === 1,
    isAdmin: Number(r.is_admin) === 1,
    createdAt: str(r.created_at),
    lastSeenAt: nullableStr(r.last_seen_at),
  };
}

/** El token va en la cookie en claro; en la DB guardamos su hash, así un
 *  dump de `auth_sessions` no permite forjar cookies. */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function seedAdminEmail(): string | null {
  const e = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  return e && e.length > 0 ? e : null;
}

export async function upsertUserFromGoogle(input: {
  googleSub: string;
  email: string;
  name: string | null;
  pictureUrl: string | null;
}): Promise<UserRow> {
  const db = getDb();
  const now = new Date().toISOString();
  const isSeedAdmin = seedAdminEmail() === input.email.toLowerCase();

  const existing = await db.execute({
    sql: 'SELECT * FROM users WHERE google_sub = ?',
    args: [input.googleSub],
  });

  if (existing.rows.length > 0) {
    const prev = rowToUser(existing.rows[0]);
    const approved = prev.approvedLogin || isSeedAdmin;
    const admin = prev.isAdmin || isSeedAdmin;
    await db.execute({
      sql: `UPDATE users
            SET email = ?, name = ?, picture_url = ?, last_seen_at = ?, approved_login = ?, is_admin = ?
            WHERE id = ?`,
      args: [input.email, input.name, input.pictureUrl, now, approved ? 1 : 0, admin ? 1 : 0, prev.id],
    });
    return {
      ...prev,
      email: input.email,
      name: input.name,
      pictureUrl: input.pictureUrl,
      lastSeenAt: now,
      approvedLogin: approved,
      isAdmin: admin,
    };
  }

  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO users
            (id, email, name, picture_url, google_sub, approved_login, is_admin, created_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, input.email, input.name, input.pictureUrl, input.googleSub, isSeedAdmin ? 1 : 0, isSeedAdmin ? 1 : 0, now, now],
  });
  return {
    id,
    email: input.email,
    name: input.name,
    pictureUrl: input.pictureUrl,
    googleSub: input.googleSub,
    approvedLogin: isSeedAdmin,
    isAdmin: isSeedAdmin,
    createdAt: now,
    lastSeenAt: now,
  };
}

export async function createAuthSession(userId: string, userAgent: string | null): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  await getDb().execute({
    sql: 'INSERT INTO auth_sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
    args: [
      hashToken(rawToken),
      userId,
      new Date(now).toISOString(),
      new Date(now + SESSION_TTL_MS).toISOString(),
      userAgent,
    ],
  });
  return rawToken;
}

export async function getUserBySessionToken(rawToken: string): Promise<UserRow | null> {
  const res = await getDb().execute({
    sql: `SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id = ? AND s.expires_at > ?`,
    args: [hashToken(rawToken), new Date().toISOString()],
  });
  return res.rows.length > 0 ? rowToUser(res.rows[0]) : null;
}

export async function deleteAuthSession(rawToken: string): Promise<void> {
  await getDb().execute({ sql: 'DELETE FROM auth_sessions WHERE id = ?', args: [hashToken(rawToken)] });
}

export async function putOAuthState(input: {
  state: string;
  codeVerifier: string;
  redirectTo: string | null;
}): Promise<void> {
  await getDb().execute({
    sql: 'INSERT INTO oauth_state (state, code_verifier, redirect_to, created_at) VALUES (?, ?, ?, ?)',
    args: [input.state, input.codeVerifier, input.redirectTo, new Date().toISOString()],
  });
}

/** Devuelve y BORRA el `state` (uso único). null si no existe o expiró. */
export async function takeOAuthState(
  state: string
): Promise<{ codeVerifier: string; redirectTo: string | null } | null> {
  const db = getDb();
  const res = await db.execute({ sql: 'SELECT * FROM oauth_state WHERE state = ?', args: [state] });
  await db.execute({ sql: 'DELETE FROM oauth_state WHERE state = ?', args: [state] });
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  const createdAt = new Date(str(row.created_at)).getTime();
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > OAUTH_STATE_TTL_MS) return null;
  return { codeVerifier: str(row.code_verifier), redirectTo: nullableStr(row.redirect_to) };
}

export async function listPendingUsers(): Promise<UserRow[]> {
  const res = await getDb().execute(
    'SELECT * FROM users WHERE approved_login = 0 ORDER BY created_at'
  );
  return res.rows.map(rowToUser);
}

export async function approveUserByEmail(email: string): Promise<boolean> {
  const res = await getDb().execute({
    sql: 'UPDATE users SET approved_login = 1 WHERE lower(email) = lower(?)',
    args: [email],
  });
  return res.rowsAffected > 0;
}

export async function approveUserById(userId: string): Promise<boolean> {
  const res = await getDb().execute({
    sql: 'UPDATE users SET approved_login = 1 WHERE id = ?',
    args: [userId],
  });
  return res.rowsAffected > 0;
}
