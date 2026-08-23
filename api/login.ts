import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildSessionCookie, passwordMatches } from './_lib/auth.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!process.env.APP_PASSWORD) {
    return res.status(500).json({
      error: 'server_misconfigured',
      message: 'APP_PASSWORD no está configurada en el servidor',
    });
  }

  const { password } = (req.body ?? {}) as { password?: string };
  if (typeof password !== 'string' || password.length === 0 || !passwordMatches(password)) {
    return res.status(401).json({ error: 'invalid_password', message: 'Contraseña incorrecta' });
  }

  res.setHeader('Set-Cookie', buildSessionCookie());
  return res.status(200).json({ ok: true });
}
