import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendError } from './_lib/errors.js';
import { withAuth } from './_lib/handler.js';
import { notionStore } from './_lib/notionStore.js';

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const body = (req.body ?? {}) as {
      block_id?: string;
      container_id?: string;
      after_block_id?: string;
    };
    const result = await notionStore.reorderTask({
      blockId: body.block_id,
      containerId: body.container_id,
      afterBlockId: body.after_block_id,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return sendError(res, err);
  }
}

export default withAuth(handler);
