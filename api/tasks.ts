import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendError } from './_lib/errors.js';
import { withAuth } from './_lib/handler.js';
import { sqliteStore } from './_lib/sqliteStore.js';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      // ?month=YYYY-MM → resumen del mes para la vista de calendario.
      if (typeof req.query.month === 'string') {
        const summary = await sqliteStore.getMonthSummary({
          month: req.query.month,
          fileId: typeof req.query.file === 'string' ? req.query.file : undefined,
        });
        return res.status(200).json(summary);
      }
      // ?heatmap=1 → horas por día de las últimas N semanas (heatmap de foco).
      if (typeof req.query.heatmap === 'string') {
        const weeks = Number(req.query.weeks);
        const heatmap = await sqliteStore.getFocusHeatmap({
          fileId: typeof req.query.file === 'string' ? req.query.file : undefined,
          weeks: Number.isFinite(weeks) ? weeks : undefined,
        });
        return res.status(200).json(heatmap);
      }
      // ?analytics=1 → agregados del panel de analítica.
      if (typeof req.query.analytics === 'string') {
        const weeks = Number(req.query.weeks);
        const analytics = await sqliteStore.getAnalytics({
          fileId: typeof req.query.file === 'string' ? req.query.file : undefined,
          weeks: Number.isFinite(weeks) ? weeks : undefined,
        });
        return res.status(200).json(analytics);
      }
      const view = await sqliteStore.getWeekView({
        fileId: typeof req.query.file === 'string' ? req.query.file : undefined,
        week: typeof req.query.week === 'string' ? req.query.week : undefined,
        day: typeof req.query.day === 'string' ? req.query.day : undefined,
      });
      return res.status(200).json(view);
    }
    // Acciones a nivel de semana/día + CRUD de etiquetas (no de una tarea
    // puntual — eso es /api/task).
    if (req.method === 'POST') {
      const body = (req.body ?? {}) as {
        action?: string;
        file?: string;
        id?: string;
        name?: string;
        color?: string;
      };
      if (body.action === 'carry_over') {
        const result = await sqliteStore.carryOverToToday({ fileId: body.file });
        return res.status(200).json({ ok: true, ...result });
      }
      if (body.action === 'create_tag') {
        const tag = await sqliteStore.createTag({ name: body.name, color: body.color });
        return res.status(200).json({ ok: true, tag });
      }
      if (body.action === 'update_tag') {
        const tag = await sqliteStore.updateTag({ id: body.id, name: body.name, color: body.color });
        return res.status(200).json({ ok: true, tag });
      }
      if (body.action === 'delete_tag') {
        await sqliteStore.deleteTag(body.id);
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'invalid_action' });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    return sendError(res, err);
  }
}

export default withAuth(handler);
