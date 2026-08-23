import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth.js';
import { appendBlockChildren, listBlockChildren, type NotionBlock } from './_lib/notion.js';
import { resolveActivePageId, richTextOf } from './_lib/notionPage.js';
import { computeNextWeekRange, formatWeekLabel, parseWeekRange, plainText, todayDateStringInTz } from './_lib/parse.js';

const TIMEZONE = process.env.APP_TIMEZONE || 'America/El_Salvador';
const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type ExistingWeeks = {
  labels: string[];
  endDates: string[];
  /** Bloque justo antes del primer heading_1 — ancla para insertar la
   *  semana nueva ahí (al tope de la lista de semanas), no al final de
   *  la página. undefined si el primer heading_1 ya es el primer bloque. */
  topAnchorBlockId: string | undefined;
};

async function loadExistingWeeks(activePageId: string): Promise<ExistingWeeks> {
  const blocks = await listBlockChildren(activePageId);
  const labels: string[] = [];
  const endDates: string[] = [];
  let topAnchorBlockId: string | undefined;
  let firstHeadingFound = false;
  let previousBlock: NotionBlock | undefined;

  for (const block of blocks) {
    if (block.type === 'heading_1') {
      if (!firstHeadingFound) {
        firstHeadingFound = true;
        topAnchorBlockId = previousBlock?.id;
      }
      const label = plainText(richTextOf(block));
      labels.push(label);
      const range = parseWeekRange(label);
      if (range) endDates.push(range.end);
    }
    previousBlock = block;
  }

  return { labels, endDates, topAnchorBlockId };
}

async function handleSuggest(res: VercelResponse, fileId: string | undefined) {
  const activePageId = await resolveActivePageId(fileId);
  const { endDates } = await loadExistingWeeks(activePageId);
  const today = todayDateStringInTz(TIMEZONE);
  const { start, end } = computeNextWeekRange(endDates, today);
  return res.status(200).json({ start, end, label: formatWeekLabel(start, end) });
}

async function handleCreate(req: VercelRequest, res: VercelResponse) {
  const body = (req.body ?? {}) as { start?: string; end?: string; file?: string };
  const { start, end, file: fileId } = body;

  if (!start || !DATE_RE.test(start)) {
    return res.status(400).json({ error: 'invalid_start', message: 'start debe ser "YYYY-MM-DD"' });
  }
  if (!end || !DATE_RE.test(end)) {
    return res.status(400).json({ error: 'invalid_end', message: 'end debe ser "YYYY-MM-DD"' });
  }
  if (end < start) {
    return res.status(400).json({ error: 'invalid_range', message: 'end no puede ser antes que start' });
  }

  const label = formatWeekLabel(start, end);
  const activePageId = await resolveActivePageId(fileId);
  const { labels, topAnchorBlockId } = await loadExistingWeeks(activePageId);

  if (labels.includes(label)) {
    return res.status(409).json({ error: 'week_exists', message: `Ya existe una semana "${label}"` });
  }

  const children = [
    { heading_1: { rich_text: [{ type: 'text', text: { content: label } }] } },
    { divider: {} },
    {
      column_list: {
        children: DAY_NAMES.map((day) => ({
          column: {
            children: [{ heading_3: { rich_text: [{ type: 'text', text: { content: day } }] } }],
          },
        })),
      },
    },
  ];

  await appendBlockChildren(activePageId, children, topAnchorBlockId);

  return res.status(200).json({ ok: true, week: { label, start, end } });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      const fileId = typeof req.query.file === 'string' ? req.query.file : undefined;
      return await handleSuggest(res, fileId);
    }
    if (req.method === 'POST') return await handleCreate(req, res);
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Error desconocido';
    return res.status(500).json({ error: 'internal_error', message });
  }
}
