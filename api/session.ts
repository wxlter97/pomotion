import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth.js';
import { sendError } from './_lib/errors.js';
import { notionStore } from './_lib/notionStore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'POST') {
      const body = (req.body ?? {}) as {
        block_id?: string;
        duration_seconds?: number;
        start_time?: string;
        end_time?: string;
        start?: string;
        end?: string;
      };
      const session = await notionStore.logSession({
        blockId: body.block_id,
        durationSeconds: body.duration_seconds,
        startTime: body.start_time,
        endTime: body.end_time,
        start: body.start,
        end: body.end,
      });
      return res.status(200).json({ ok: true, session });
    }
    if (req.method === 'PATCH') {
      const body = (req.body ?? {}) as {
        block_id?: string;
        duration_seconds?: number;
        start?: string;
        end?: string;
      };
      const session = await notionStore.updateSession({
        blockId: body.block_id,
        durationSeconds: body.duration_seconds,
        start: body.start,
        end: body.end,
      });
      return res
        .status(200)
        .json({ ok: true, session: { durationSeconds: session.durationSeconds, start: session.start, end: session.end } });
    }
    if (req.method === 'DELETE') {
      const body = (req.body ?? {}) as { block_id?: string };
      await notionStore.deleteSession(body.block_id);
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'POST, PATCH, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    return sendError(res, err);
  }
}
