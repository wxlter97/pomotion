import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth';
import { listBlockChildren, type NotionBlock } from './_lib/notion';
import {
  extractNotionPageId,
  isDateInRange,
  normalize,
  parseSessionText,
  parseWeekRange,
  plainText,
  todayDateStringInTz,
  todayWeekdayNameInTz,
} from './_lib/parse';

const TIMEZONE = process.env.APP_TIMEZONE || 'America/El_Salvador';

type WeekGroup = {
  label: string;
  range: { start: string; end: string } | null;
  blocks: NotionBlock[];
};

async function resolveActivePageId(): Promise<string> {
  const indexPageId = process.env.NOTION_INDEX_PAGE_ID;
  if (!indexPageId) {
    throw new Error('NOTION_INDEX_PAGE_ID no está configurada');
  }
  const blocks = await listBlockChildren(indexPageId);
  for (const block of blocks) {
    const content = block[block.type] as { rich_text?: { plain_text?: string }[] } | undefined;
    const text = plainText(content?.rich_text);
    if (!text) continue;
    const pageId = extractNotionPageId(text);
    if (pageId) return pageId;
  }
  throw new Error(
    'No se encontró ninguna referencia a una página semanal (URL o ID) en la página índice de Notion'
  );
}

function richTextOf(block: NotionBlock): { plain_text?: string }[] | undefined {
  const content = block[block.type] as { rich_text?: { plain_text?: string }[] } | undefined;
  return content?.rich_text;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!requireAuth(req, res)) return;

  try {
    const activePageId = await resolveActivePageId();
    const blocks = await listBlockChildren(activePageId);

    // 1. Agrupar por heading_1 (semana).
    const weeks: WeekGroup[] = [];
    let currentWeek: WeekGroup | null = null;
    for (const block of blocks) {
      if (block.type === 'heading_1') {
        const label = plainText(richTextOf(block));
        currentWeek = { label, range: parseWeekRange(label), blocks: [] };
        weeks.push(currentWeek);
      } else if (currentWeek) {
        currentWeek.blocks.push(block);
      }
    }

    if (weeks.length === 0) {
      return res.status(404).json({
        error: 'no_weeks_found',
        message: 'No se encontró ningún heading_1 (semana) en la página activa',
      });
    }

    const today = todayDateStringInTz(TIMEZONE);
    let activeWeek = weeks.find((w) => w.range && isDateInRange(today, w.range.start, w.range.end));
    const weekMatched = Boolean(activeWeek);
    if (!activeWeek) {
      // Fallback transparente: la más reciente que tenga rango parseable, o la última si ninguna lo tiene.
      activeWeek =
        [...weeks].reverse().find((w) => w.range) ?? weeks[weeks.length - 1];
    }

    // 2. Dentro de la semana activa, agrupar to_do por heading_3 (día).
    const dayOrder: string[] = [];
    const dayBlocks = new Map<string, NotionBlock[]>();
    let currentDayLabel: string | null = null;
    for (const block of activeWeek.blocks) {
      if (block.type === 'heading_3') {
        currentDayLabel = plainText(richTextOf(block));
        if (currentDayLabel && !dayOrder.includes(currentDayLabel)) {
          dayOrder.push(currentDayLabel);
          dayBlocks.set(currentDayLabel, []);
        }
      } else if (block.type === 'to_do' && currentDayLabel) {
        dayBlocks.get(currentDayLabel)?.push(block);
      }
    }

    if (dayOrder.length === 0) {
      return res.status(404).json({
        error: 'no_days_found',
        message: `No se encontró ningún heading_3 (día) dentro de la semana "${activeWeek.label}"`,
      });
    }

    const requestedDay = typeof req.query.day === 'string' ? req.query.day : undefined;
    const todayWeekday = todayWeekdayNameInTz(TIMEZONE);

    let selectedDay = requestedDay
      ? dayOrder.find((d) => normalize(d) === normalize(requestedDay))
      : undefined;
    const dayMatched = requestedDay ? Boolean(selectedDay) : true;
    if (!selectedDay) selectedDay = dayOrder.find((d) => normalize(d) === todayWeekday);
    const autoDayMatched = Boolean(selectedDay);
    if (!selectedDay) selectedDay = dayOrder[0];

    const todoBlocks = dayBlocks.get(selectedDay) ?? [];

    // 3. Para cada to_do del día seleccionado, traer sus hijos (sesiones ya registradas).
    const tasks = await Promise.all(
      todoBlocks.map(async (block) => {
        const content = block.to_do as { rich_text?: { plain_text?: string }[]; checked?: boolean };
        const text = plainText(content?.rich_text);
        const checked = Boolean(content?.checked);

        let sessions: { durationMinutes: number; start: string; end: string }[] = [];
        if (block.has_children) {
          const children = await listBlockChildren(block.id);
          sessions = children
            .map((child) => parseSessionText(plainText(richTextOf(child))))
            .filter((s): s is NonNullable<typeof s> => s !== null);
        }

        return { blockId: block.id, text, checked, day: selectedDay as string, sessions };
      })
    );

    return res.status(200).json({
      week: activeWeek.label,
      weekMatched,
      availableDays: dayOrder,
      selectedDay,
      dayMatched: requestedDay ? dayMatched : autoDayMatched,
      tasks,
    });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Error desconocido';
    return res.status(500).json({ error: 'internal_error', message });
  }
}
