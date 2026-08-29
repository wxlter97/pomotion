import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendError } from './_lib/errors.js';
import { withAuth } from './_lib/handler.js';
import { sqliteStore } from './_lib/sqliteStore.js';

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const view = await sqliteStore.getWeekView({
      fileId: typeof req.query.file === 'string' ? req.query.file : undefined,
      week: typeof req.query.week === 'string' ? req.query.week : undefined,
      day: typeof req.query.day === 'string' ? req.query.day : undefined,
    });
    return res.status(200).json(view);
  } catch (err) {
    return sendError(res, err);
  }
}

export default withAuth(handler);
