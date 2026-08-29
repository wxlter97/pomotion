import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthedUser } from '../_lib/auth.js';

/**
 * Estado de login del visitante para el frontend:
 * - `{ authed: false }` — sin sesión.
 * - `{ authed: true, approved: false }` — logueado, cuenta pendiente.
 * - `{ authed: true, approved: true, user }` — adentro.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const user = await getAuthedUser(req);
    if (!user) return res.status(200).json({ authed: false });
    return res.status(200).json({
      authed: true,
      approved: user.approvedLogin,
      user: {
        email: user.email,
        name: user.name,
        pictureUrl: user.pictureUrl,
        isAdmin: user.isAdmin,
      },
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ error: 'internal_error', message: err instanceof Error ? err.message : 'Error desconocido' });
  }
}
