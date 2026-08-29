import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUserBySessionToken, type UserRow } from './authRepo.js';

const SESSION_COOKIE = 'pomotion_session';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 días

function isProdRequest(): boolean {
  return process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
}

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return out;
}

/** Agrega un `Set-Cookie` sin pisar los que ya haya puesto el handler. */
function appendSetCookie(res: VercelResponse, cookie: string): void {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', cookie);
  else if (Array.isArray(prev)) res.setHeader('Set-Cookie', [...prev, cookie]);
  else res.setHeader('Set-Cookie', [String(prev), cookie]);
}

export function getSessionToken(req: VercelRequest): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

export function setSessionCookie(res: VercelResponse, rawToken: string): void {
  const parts = [
    `${SESSION_COOKIE}=${rawToken}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (isProdRequest()) parts.push('Secure');
  appendSetCookie(res, parts.join('; '));
}

export function clearSessionCookie(res: VercelResponse): void {
  appendSetCookie(res, `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** La fila del usuario de la sesión actual, o null (cookie ausente,
 *  inválida, expirada, o el usuario ya no existe). */
export function getAuthedUser(req: VercelRequest): Promise<UserRow | null> {
  const token = getSessionToken(req);
  if (!token) return Promise.resolve(null);
  return getUserBySessionToken(token);
}
