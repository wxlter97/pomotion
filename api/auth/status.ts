import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthedUser } from '../_lib/auth.js';
import { listUsersForAdmin, setUserApproval, type UserRow } from '../_lib/authRepo.js';

/**
 * Endpoint de auth para el frontend:
 * - `GET /api/auth/status` — estado de login del visitante (sin auth):
 *     `{ authed: false }` · `{ authed: true, approved: false }` ·
 *     `{ authed: true, approved: true, user }`.
 * - `GET /api/auth/status?users=1` — (admin) lista de usuarios para el panel
 *     de aprobación.
 * - `POST /api/auth/status` `{ action: 'approve' | 'revoke', userId }` —
 *     (admin) cambia `approved_login` de un usuario.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET' && typeof req.query.users === 'string') {
      return handleListUsers(req, res);
    }
    if (req.method === 'GET') {
      return handleStatus(req, res);
    }
    if (req.method === 'POST') {
      return handleSetApproval(req, res);
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ error: 'internal_error', message: err instanceof Error ? err.message : 'Error desconocido' });
  }
}

async function handleStatus(req: VercelRequest, res: VercelResponse) {
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
}

/** Vista de un usuario para el panel de admin (sin `googleSub`). */
function toAdminUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    pictureUrl: u.pictureUrl,
    approved: u.approvedLogin,
    isAdmin: u.isAdmin,
    createdAt: u.createdAt,
    lastSeenAt: u.lastSeenAt,
  };
}

async function requireAdmin(req: VercelRequest, res: VercelResponse): Promise<UserRow | null> {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  if (!user.isAdmin) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return user;
}

async function handleListUsers(req: VercelRequest, res: VercelResponse) {
  if (!(await requireAdmin(req, res))) return;
  const users = await listUsersForAdmin();
  return res.status(200).json({ users: users.map(toAdminUser) });
}

async function handleSetApproval(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const body = (req.body ?? {}) as { action?: string; userId?: string };
  if (body.action !== 'approve' && body.action !== 'revoke') {
    return res.status(400).json({ error: 'invalid_action' });
  }
  if (!body.userId) {
    return res.status(400).json({ error: 'invalid_user_id' });
  }
  if (body.action === 'revoke' && body.userId === admin.id) {
    return res.status(400).json({ error: 'cannot_revoke_self', message: 'No podés revocarte a vos.' });
  }

  const ok = await setUserApproval(body.userId, body.action === 'approve');
  if (!ok) return res.status(404).json({ error: 'user_not_found' });
  return res.status(200).json({ ok: true });
}
