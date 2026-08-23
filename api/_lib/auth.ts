import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const COOKIE_NAME = 'pomotion_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

function getSecret(): string {
  const secret = process.env.APP_PASSWORD;
  if (!secret) {
    throw new Error('APP_PASSWORD no está configurada');
  }
  return secret;
}

function sign(value: string): string {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('hex');
}

function isProdRequest(): boolean {
  return process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
}

/** Password comparado en tiempo constante para evitar timing attacks. */
export function passwordMatches(candidate: string): boolean {
  const expected = getSecret();
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function buildSessionCookie(): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = String(expiresAt);
  const token = `${payload}.${sign(payload)}`;
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isProdRequest()) parts.push('Secure');
  return parts.join('; ');
}

export function buildLogoutCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
  }
  return out;
}

export function isAuthenticated(req: VercelRequest): boolean {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return false;
  }
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
  return true;
}

/** Devuelve false (y ya respondió 401) si la request no está autenticada. */
export function requireAuth(req: VercelRequest, res: VercelResponse): boolean {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}
