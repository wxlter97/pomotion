import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendError } from './_lib/errors.js';
import { withAuth } from './_lib/handler.js';
import { sqliteStore } from './_lib/sqliteStore.js';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ rules: await sqliteStore.listRecurringRules() });
    }
    if (req.method === 'POST') {
      const body = (req.body ?? {}) as {
        action?: string;
        id?: string;
        name?: string;
        freq?: string;
        weekdays?: string;
        monthdays?: string;
        default_planned_start?: string | null;
        active?: boolean;
        week?: string;
        file?: string;
      };
      switch (body.action) {
        case 'create': {
          const rule = await sqliteStore.createRecurringRule({
            name: body.name,
            fileId: body.file,
            freq: body.freq,
            weekdays: body.weekdays,
            monthdays: body.monthdays,
            defaultPlannedStart: body.default_planned_start,
          });
          return res.status(200).json({ ok: true, rule });
        }
        case 'update': {
          const rule = await sqliteStore.updateRecurringRule({
            id: body.id,
            name: body.name,
            active: body.active,
            freq: body.freq,
            weekdays: body.weekdays,
            monthdays: body.monthdays,
            defaultPlannedStart: body.default_planned_start,
          });
          return res.status(200).json({ ok: true, rule });
        }
        case 'delete': {
          await sqliteStore.deleteRecurringRule(body.id);
          return res.status(200).json({ ok: true });
        }
        case 'apply': {
          const result = await sqliteStore.applyRecurringToWeek({ week: body.week, fileId: body.file });
          return res.status(200).json({ ok: true, ...result });
        }
        default:
          return res.status(400).json({ error: 'invalid_action' });
      }
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    return sendError(res, err);
  }
}

export default withAuth(handler);
