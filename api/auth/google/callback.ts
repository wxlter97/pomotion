import type { VercelRequest, VercelResponse } from '@vercel/node';
import { setSessionCookie } from '../../_lib/auth.js';
import { createAuthSession, takeOAuthState, upsertUserFromGoogle } from '../../_lib/authRepo.js';
import { exchangeCode, googleConfig } from '../../_lib/googleOAuth.js';

function fail(res: VercelResponse, reason: string) {
  return res.redirect(302, `/?auth_error=${encodeURIComponent(reason)}`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (error) return fail(res, 'google_denied');
  if (!code || !state) return fail(res, 'missing_params');

  const saved = await takeOAuthState(state);
  if (!saved) return fail(res, 'state');

  let cfg;
  try {
    cfg = googleConfig();
  } catch {
    return fail(res, 'server_misconfigured');
  }

  let identity;
  try {
    identity = await exchangeCode(cfg, code, saved.codeVerifier);
  } catch (err) {
    console.error('Google token exchange falló:', err);
    return fail(res, 'token_exchange');
  }

  if (!identity.emailVerified) return fail(res, 'email_unverified');

  try {
    const user = await upsertUserFromGoogle({
      googleSub: identity.sub,
      email: identity.email,
      name: identity.name,
      pictureUrl: identity.picture,
    });
    const token = await createAuthSession(user.id, req.headers['user-agent'] ?? null);
    setSessionCookie(res, token);
    return res.redirect(302, saved.redirectTo ?? '/');
  } catch (err) {
    console.error('No se pudo crear la sesión:', err);
    return fail(res, 'session_failed');
  }
}
