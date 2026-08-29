import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendError } from './_lib/errors.js';
import { withAuth } from './_lib/handler.js';
import { sqliteStore } from './_lib/sqliteStore.js';

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const body = (req.body ?? {}) as { id?: string; date?: string; after_id?: string | null };
    const result = await sqliteStore.updateTaskPosition({
      taskId: body.id,
      date: body.date,
      afterId: body.after_id,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return sendError(res, err);
  }
}

export default withAuth(handler);
