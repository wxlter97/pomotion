import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendError } from './_lib/errors.js';
import { withAuth } from './_lib/handler.js';
import { sqliteStore } from './_lib/sqliteStore.js';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      const habits = await sqliteStore.listHabits({
        contextId: typeof req.query.context === 'string' ? req.query.context : undefined,
      });
      return res.status(200).json({ habits });
    }

    if (req.method === 'POST') {
      const body = (req.body ?? {}) as {
        action?: string;
        id?: string;
        context_id?: string;
        name?: string;
        color?: string;
        archived?: boolean;
        order?: number;
        date?: string;
        done?: boolean;
      };
      if (body.action === 'create_habit') {
        const habit = await sqliteStore.createHabit({ contextId: body.context_id, name: body.name, color: body.color });
        return res.status(200).json({ ok: true, habit });
      }
      if (body.action === 'update_habit') {
        const habit = await sqliteStore.updateHabit({
          id: body.id,
          name: body.name,
          color: body.color,
          archived: body.archived,
          order: body.order,
        });
        return res.status(200).json({ ok: true, habit });
      }
      if (body.action === 'delete_habit') {
        await sqliteStore.deleteHabit(body.id);
        return res.status(200).json({ ok: true });
      }
      if (body.action === 'toggle_log') {
        const result = await sqliteStore.toggleHabitLog({
          habitId: body.id,
          date: body.date,
          done: body.done,
        });
        return res.status(200).json({ ok: true, ...result });
      }
      res.setHeader('Allow', 'GET, POST');
      return res.status(400).json({ error: 'unknown_action' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    return sendError(res, err);
  }
}

export default withAuth(handler);
