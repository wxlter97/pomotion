import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthedUser } from './auth.js';
import type { UserRow } from './authRepo.js';
import { runWithUser } from './requestContext.js';

export type AuthedHandler = (
  req: VercelRequest,
  res: VercelResponse,
  user: UserRow
) => unknown | Promise<unknown>;

/**
 * Envuelve un handler de `/api/*`: exige sesión válida (401 si no hay),
 * exige `approved_login` (403 `pending_approval` si no), y corre el
 * handler con la identidad del usuario en el contexto de la request
 * (ver requestContext.ts). Reemplaza el `if (!requireAuth(...)) return`
 * que tenía cada endpoint.
 */
export function withAuth(handler: AuthedHandler) {
  return async (req: VercelRequest, res: VercelResponse) => {
    try {
      const user = await getAuthedUser(req);
      if (!user) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      if (!user.approvedLogin) {
        res
          .status(403)
          .json({ error: 'pending_approval', message: 'Tu cuenta está pendiente de aprobación.' });
        return;
      }
      await runWithUser({ userId: user.id, isAdmin: user.isAdmin }, async () => {
        await handler(req, res, user);
      });
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ error: 'internal_error', message: err instanceof Error ? err.message : 'Error desconocido' });
      }
    }
  };
}
