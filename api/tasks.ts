import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendError } from './_lib/errors.js';
import { withAuth } from './_lib/handler.js';
import { sqliteStore } from './_lib/sqliteStore.js';
import type { DayTemplateItemInput } from './_lib/taskStore.js';

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
      // ?goals=1 → metas del usuario con su progreso del mes.
      if (typeof req.query.goals === 'string') {
        return res.status(200).json({ goals: await sqliteStore.listGoals() });
      }
      // ?search=<q> → tareas cuyo nombre contiene el texto (todas las semanas + inbox).
      if (typeof req.query.search === 'string') {
        const results = await sqliteStore.searchTasks({
          query: req.query.search,
          fileId: typeof req.query.file === 'string' ? req.query.file : undefined,
        });
        return res.status(200).json({ results });
      }
      // ?feeds=1 → calendarios iCal suscriptos.
      if (typeof req.query.feeds === 'string') {
        return res.status(200).json({ feeds: await sqliteStore.listCalendarFeeds() });
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
        date?: string;
        from_date?: string;
        items?: DayTemplateItemInput[];
        tag_id?: string | null;
        target_minutes?: number;
        url?: string;
        enabled?: boolean;
        feed_id?: string;
        force?: boolean;
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
      if (body.action === 'create_template') {
        const template = await sqliteStore.createDayTemplate({
          name: body.name,
          fileId: body.file,
          items: body.items,
          fromDate: body.from_date,
        });
        return res.status(200).json({ ok: true, template });
      }
      if (body.action === 'update_template') {
        const template = await sqliteStore.updateDayTemplate({
          id: body.id,
          name: body.name,
          items: body.items,
        });
        return res.status(200).json({ ok: true, template });
      }
      if (body.action === 'delete_template') {
        await sqliteStore.deleteDayTemplate(body.id);
        return res.status(200).json({ ok: true });
      }
      if (body.action === 'apply_template') {
        const result = await sqliteStore.applyDayTemplate({
          id: body.id,
          date: body.date,
          fileId: body.file,
        });
        return res.status(200).json({ ok: true, ...result });
      }
      if (body.action === 'create_goal') {
        const goal = await sqliteStore.createGoal({
          tagId: body.tag_id,
          targetMinutes: body.target_minutes,
          fileId: body.file,
        });
        return res.status(200).json({ ok: true, goal });
      }
      if (body.action === 'update_goal') {
        const goal = await sqliteStore.updateGoal({
          id: body.id,
          tagId: 'tag_id' in body ? body.tag_id : undefined,
          targetMinutes: body.target_minutes,
        });
        return res.status(200).json({ ok: true, goal });
      }
      if (body.action === 'delete_goal') {
        await sqliteStore.deleteGoal(body.id);
        return res.status(200).json({ ok: true });
      }
      if (body.action === 'create_feed') {
        const feed = await sqliteStore.createCalendarFeed({
          name: body.name,
          url: body.url,
          fileId: body.file ?? null,
        });
        return res.status(200).json({ ok: true, feed });
      }
      if (body.action === 'update_feed') {
        const feed = await sqliteStore.updateCalendarFeed({
          id: body.id,
          name: body.name,
          enabled: body.enabled,
          fileId: 'file' in body ? (body.file ?? null) : undefined,
        });
        return res.status(200).json({ ok: true, feed });
      }
      if (body.action === 'delete_feed') {
        await sqliteStore.deleteCalendarFeed(body.id);
        return res.status(200).json({ ok: true });
      }
      if (body.action === 'sync_feeds') {
        const result = await sqliteStore.syncCalendarFeeds({
          feedId: body.feed_id,
          force: body.force === true || typeof body.feed_id === 'string',
        });
        return res.status(200).json({ ok: true, ...result });
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
