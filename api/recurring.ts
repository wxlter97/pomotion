import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth.js';
import { sendError } from './_lib/errors.js';
import { notionStore } from './_lib/notionStore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      const fileId = typeof req.query.file === 'string' ? req.query.file : undefined;
      const result = await notionStore.listRecurringTasks(fileId);
      return res.status(200).json(result);
    }
    if (req.method === 'POST') {
      const body = (req.body ?? {}) as { action?: string; week?: string; file?: string };
      if (body.action === 'ensure') {
        const result = await notionStore.ensureRecurringSection(body.file);
        return res.status(200).json({ ok: true, ...result });
      }
      const result = await notionStore.applyRecurringToWeek({ fileId: body.file, week: body.week });
      return res.status(200).json({ ok: true, ...result });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    return sendError(res, err);
  }
}
