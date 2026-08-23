import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildLogoutCookie } from './_lib/auth';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  res.setHeader('Set-Cookie', buildLogoutCookie());
  return res.status(200).json({ ok: true });
}
