import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth.js';
import { sendError } from './_lib/errors.js';
import { notionStore } from './_lib/notionStore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'PATCH') {
      const body = (req.body ?? {}) as { block_id?: string; checked?: boolean; text?: string };
      const result = await notionStore.updateTask({
        blockId: body.block_id,
        checked: body.checked,
        text: body.text,
      });
      return res.status(200).json({ ok: true, ...result });
    }
    if (req.method === 'POST') {
      const body = (req.body ?? {}) as { container_id?: string; after_block_id?: string; text?: string };
      const task = await notionStore.createTask({
        containerId: body.container_id,
        afterBlockId: body.after_block_id,
        text: body.text,
      });
      return res.status(200).json({ ok: true, task });
    }
    if (req.method === 'DELETE') {
      const body = (req.body ?? {}) as { block_id?: string };
      await notionStore.deleteTask(body.block_id);
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'PATCH, POST, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    return sendError(res, err);
  }
}
