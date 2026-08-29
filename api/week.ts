import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendError } from './_lib/errors.js';
import { withAuth } from './_lib/handler.js';
import { notionStore } from './_lib/notionStore.js';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      const fileId = typeof req.query.file === 'string' ? req.query.file : undefined;
      return res.status(200).json(await notionStore.suggestNextWeek(fileId));
    }
    if (req.method === 'POST') {
      const body = (req.body ?? {}) as { start?: string; end?: string; file?: string };
      const week = await notionStore.createWeek({ start: body.start, end: body.end, fileId: body.file });
      return res.status(200).json({ ok: true, week });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    return sendError(res, err);
  }
}

export default withAuth(handler);
