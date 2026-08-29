import { getCached, setCached } from './_lib/apiCache.js';
import { sendError } from './_lib/errors.js';
import { withAuth } from './_lib/handler.js';
import { notionStore } from './_lib/notionStore.js';
import { currentUserId } from './_lib/requestContext.js';
import type { WeekView } from './_lib/store.js';

// Armar la vista semanal cuesta decenas de llamadas a Notion. Una caché
// corta absorbe las cargas repetidas de la misma vista (doble fetch al
// montar, ir y volver entre días) sin arriesgar datos viejos: el cliente
// pide `?fresh=1` después de cualquier mutación (ver pendingFreshRef en
// App.tsx) y en el botón de "Actualizar".
const WEEK_VIEW_TTL_MS = 30_000;

export default withAuth(async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const opts = {
    fileId: typeof req.query.file === 'string' ? req.query.file : undefined,
    week: typeof req.query.week === 'string' ? req.query.week : undefined,
    day: typeof req.query.day === 'string' ? req.query.day : undefined,
  };
  const cacheKey = `weekview:${currentUserId()}|${opts.fileId ?? ''}|${opts.week ?? ''}|${opts.day ?? ''}`;
  const fresh = req.query.fresh === '1';

  try {
    if (!fresh) {
      const cached = getCached<WeekView>(cacheKey);
      if (cached) return res.status(200).json(cached);
    }
    const view = await notionStore.getWeekView(opts);
    setCached(cacheKey, view, WEEK_VIEW_TTL_MS);
    return res.status(200).json(view);
  } catch (err) {
    return sendError(res, err);
  }
});
