/**
 * Flujo OAuth2 + PKCE contra Google, para "Continuar con Google". Solo se
 * usa la identidad (sub/email/nombre/foto) — no se guardan tokens de Google.
 * Helpers puros acá; los endpoints (`api/auth/google/*`) los orquestan.
 */
import crypto from 'node:crypto';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function googleConfig(): GoogleConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const base = process.env.APP_BASE_URL;
  if (!clientId || !clientSecret || !base) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / APP_BASE_URL no están configuradas');
  }
  return {
    clientId,
    clientSecret,
    redirectUri: `${base.replace(/\/+$/, '')}/api/auth/google/callback`,
  };
}

export function makePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function authorizeUrl(cfg: GoogleConfig, state: string, challenge: string): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('access_type', 'online');
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

export type GoogleIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
};

export async function exchangeCode(
  cfg: GoogleConfig,
  code: string,
  codeVerifier: string
): Promise<GoogleIdentity> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange respondió ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new Error('Google no devolvió id_token');
  return parseIdToken(body.id_token);
}

/**
 * El `id_token` viene directo del endpoint de token de Google sobre TLS,
 * así que por el flujo de authorization code no hace falta verificar la
 * firma (OpenID Connect §3.1.3.7 — "the Client MAY do id_token validation
 * ... unless the token was received via a direct communication ...").
 * Solo decodificamos el payload.
 */
export function parseIdToken(idToken: string): GoogleIdentity {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('id_token con formato inválido');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  const { sub, email } = payload;
  if (typeof sub !== 'string' || typeof email !== 'string') {
    throw new Error('id_token sin sub/email');
  }
  return {
    sub,
    email,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: typeof payload.name === 'string' ? payload.name : null,
    picture: typeof payload.picture === 'string' ? payload.picture : null,
  };
}
