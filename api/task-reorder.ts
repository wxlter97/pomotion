import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth.js';
import { sendError } from './_lib/errors.js';
import { reorderTask } from './_lib/notionStore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!requireAuth(req, res)) return;

  try {
    const body = (req.body ?? {}) as {
      block_id?: string;
      container_id?: string;
      after_block_id?: string;
    };
    const result = await reorderTask({
      blockId: body.block_id,
      containerId: body.container_id,
      afterBlockId: body.after_block_id,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return sendError(res, err);
  }
}
