import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendError } from './_lib/errors.js';
import { withAuth } from './_lib/handler.js';
import { sqliteStore } from './_lib/sqliteStore.js';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'PATCH') {
      const body = (req.body ?? {}) as { id?: string; done?: boolean; text?: string };
      const result = await sqliteStore.updateTask({ taskId: body.id, done: body.done, text: body.text });
      return res.status(200).json({ ok: true, ...result });
    }
    if (req.method === 'POST') {
      const body = (req.body ?? {}) as {
        date?: string;
        text?: string;
        file?: string;
        after_id?: string | null;
      };
      const task = await sqliteStore.createTask({
        date: body.date,
        text: body.text,
        fileId: body.file,
        afterId: body.after_id,
      });
      return res.status(200).json({ ok: true, task });
    }
    if (req.method === 'DELETE') {
      const body = (req.body ?? {}) as { id?: string };
      await sqliteStore.deleteTask(body.id);
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'PATCH, POST, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    return sendError(res, err);
  }
}

export default withAuth(handler);
