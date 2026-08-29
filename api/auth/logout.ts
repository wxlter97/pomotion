import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clearSessionCookie, getSessionToken } from '../_lib/auth.js';
import { deleteAuthSession } from '../_lib/authRepo.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const token = getSessionToken(req);
  if (token) {
    try {
      await deleteAuthSession(token);
    } catch (err) {
      console.error('No se pudo borrar la sesión de la DB:', err);
    }
  }
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}
