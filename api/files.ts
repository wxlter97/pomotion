import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendError } from './_lib/errors.js';
import { withAuth } from './_lib/handler.js';
import { notionStore } from './_lib/notionStore.js';

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const files = await notionStore.listFiles();
    return res.status(200).json({ files });
  } catch (err) {
    return sendError(res, err);
  }
}

export default withAuth(handler);
