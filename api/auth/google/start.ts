import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authorizeUrl, googleConfig, makePkce } from '../../_lib/googleOAuth.js';
import { putOAuthState } from '../../_lib/authRepo.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  let cfg;
  try {
    cfg = googleConfig();
  } catch (err) {
    return res.status(500).json({
      error: 'server_misconfigured',
      message: err instanceof Error ? err.message : 'config de Google incompleta',
    });
  }

  const state = crypto.randomBytes(24).toString('base64url');
  const { verifier, challenge } = makePkce();
  const next =
    typeof req.query.next === 'string' && req.query.next.startsWith('/') ? req.query.next : null;

  await putOAuthState({ state, codeVerifier: verifier, redirectTo: next });
  return res.redirect(302, authorizeUrl(cfg, state, challenge));
}
