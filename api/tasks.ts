import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth.js';
import { listBlockChildren, type NotionBlock } from './_lib/notion.js';
import {
  extractNotionPageId,
  isDateInRange,
  normalize,
  parseSessionText,
  parseWeekRange,
  plainText,
  todayDateStringInTz,
  todayWeekdayNameInTz,
} from './_lib/parse.js';

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

/**
 * La plantilla real organiza cada semana en columnas de Notion (un
 * `column_list` con un `column` por día), en vez de heading_3/to_do como
 * hermanos planos. Esto "aplana" esa estructura recursivamente para que el
 * agrupado por día funcione igual sin importar cuál de las dos formas use
 * la página. Solo se llama sobre la semana activa (no sobre todo el
 * historial), para no multiplicar las llamadas a la API de Notion.
 */
async function expandColumns(blocks: NotionBlock[], depth = 0): Promise<NotionBlock[]> {
  if (depth > 3) return blocks;
  const expanded: NotionBlock[] = [];
  for (const block of blocks) {
    if (block.type === 'column_list' && block.has_children) {
      const columns = await listBlockChildren(block.id);
      for (const column of columns) {
        if (column.type === 'column' && column.has_children) {
          const columnChildren = await listBlockChildren(column.id);
          expanded.push(...(await expandColumns(columnChildren, depth + 1)));
        }
      }
    } else {
      expanded.push(block);
    }
  }
  return expanded;
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
    // Un rango solo es válido si start <= end (protege contra encabezados con
    // typos, ej. "2026.08.03 - 2026.03.07").
    const hasValidRange = (w: WeekGroup): w is WeekGroup & { range: { start: string; end: string } } =>
      Boolean(w.range) && w.range!.start <= w.range!.end;

    const todayWeek = weeks.find((w) => hasValidRange(w) && isDateInRange(today, w.range.start, w.range.end));
    const requestedWeek = typeof req.query.week === 'string' ? req.query.week : undefined;

    let activeWeek: WeekGroup;
    // 'auto-matched': hoy cae exactamente dentro de un heading_1.
    // 'auto-fallback': no hay match exacto (ej. fin de semana entre dos
    //   semanas) y se usa una heurística — dispara el aviso en la UI.
    // 'requested': el usuario navegó explícitamente a otra semana — no
    //   dispara ningún aviso, fue intencional.
    let weekSource: 'auto-matched' | 'auto-fallback' | 'requested';

    if (requestedWeek) {
      const found = weeks.find((w) => w.label === requestedWeek);
      if (!found) {
        return res.status(404).json({
          error: 'week_not_found',
          message: `No se encontró la semana "${requestedWeek}"`,
        });
      }
      activeWeek = found;
      weekSource = 'requested';
    } else if (todayWeek) {
      activeWeek = todayWeek;
      weekSource = 'auto-matched';
    } else {
      // Preferir la semana ya terminada más reciente; si todas las semanas
      // con rango válido son futuras, la más próxima a empezar; si ninguna
      // semana tiene rango parseable, la primera del documento (por
      // posición, normalmente la más reciente en esta plantilla).
      const validRanged = weeks.filter(hasValidRange);
      const past = validRanged.filter((w) => w.range.end < today);
      const future = validRanged.filter((w) => w.range.start > today);
      if (past.length > 0) {
        activeWeek = past.reduce((a, b) => (a.range.end > b.range.end ? a : b));
      } else if (future.length > 0) {
        activeWeek = future.reduce((a, b) => (a.range.start < b.range.start ? a : b));
      } else {
        activeWeek = weeks[0];
      }
      weekSource = 'auto-fallback';
    }

    // Navegación anterior/siguiente: en orden cronológico (por fecha de
    // inicio), no por posición en el documento — así funciona sin importar
    // si la plantilla lista las semanas de más nueva a más vieja o al revés.
    const navigableWeeks = weeks.filter(hasValidRange).sort((a, b) => (a.range.start < b.range.start ? -1 : a.range.start > b.range.start ? 1 : 0));
    const activeIndex = navigableWeeks.findIndex((w) => w === activeWeek);
    const previousWeekLabel = activeIndex > 0 ? navigableWeeks[activeIndex - 1].label : null;
    const nextWeekLabel =
      activeIndex >= 0 && activeIndex < navigableWeeks.length - 1 ? navigableWeeks[activeIndex + 1].label : null;
    const isCurrentWeek = Boolean(todayWeek) && activeWeek === todayWeek;

    // 2. Dentro de la semana activa, agrupar to_do por heading_3 (día).
    //    (aplanando columnas si la semana usa layout de columnas por día)
    const activeWeekBlocks = await expandColumns(activeWeek.blocks);
    const dayOrder: string[] = [];
    const dayBlocks = new Map<string, NotionBlock[]>();
    let currentDayLabel: string | null = null;
    for (const block of activeWeekBlocks) {
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
      // Semana válida pero sin desglose por día (ej. una semana de
      // vacaciones anotada solo con una nota). No es un error — se navega
      // ahí con las flechas de semana igual que cualquier otra.
      return res.status(200).json({
        week: activeWeek.label,
        weekSource,
        isCurrentWeek,
        previousWeekLabel,
        nextWeekLabel,
        availableDays: [],
        selectedDay: null,
        dayMatched: true,
        tasks: [],
      });
    }

    const requestedDay = typeof req.query.day === 'string' ? req.query.day : undefined;
    const todayWeekday = todayWeekdayNameInTz(TIMEZONE);

    let selectedDay: string | undefined;
    let dayMatched: boolean;
    if (requestedDay) {
      selectedDay = dayOrder.find((d) => normalize(d) === normalize(requestedDay));
      dayMatched = Boolean(selectedDay);
    } else if (weekSource === 'requested') {
      // Se navegó explícitamente a otra semana: no tiene sentido buscar "el
      // día de hoy" ahí — se cae directo al primer día sin marcar como
      // "no encontrado".
      dayMatched = true;
    } else {
      selectedDay = dayOrder.find((d) => normalize(d) === todayWeekday);
      dayMatched = Boolean(selectedDay);
    }
    if (!selectedDay) selectedDay = dayOrder[0];

    const todoBlocks = dayBlocks.get(selectedDay) ?? [];

    // 3. Para cada to_do del día seleccionado, traer sus hijos (sesiones ya registradas).
    const tasks = await Promise.all(
      todoBlocks.map(async (block) => {
        const content = block.to_do as { rich_text?: { plain_text?: string }[]; checked?: boolean };
        const text = plainText(content?.rich_text);
        const checked = Boolean(content?.checked);

        let sessions: { blockId: string; durationMinutes: number; start: string; end: string }[] = [];
        if (block.has_children) {
          const children = await listBlockChildren(block.id);
          sessions = children
            .map((child) => {
              const parsed = parseSessionText(plainText(richTextOf(child)));
              return parsed ? { ...parsed, blockId: child.id } : null;
            })
            .filter((s): s is NonNullable<typeof s> => s !== null);
        }

        return { blockId: block.id, text, checked, day: selectedDay as string, sessions };
      })
    );

    return res.status(200).json({
      week: activeWeek.label,
      weekSource,
      isCurrentWeek,
      previousWeekLabel,
      nextWeekLabel,
      availableDays: dayOrder,
      selectedDay,
      dayMatched,
      tasks,
    });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Error desconocido';
    return res.status(500).json({ error: 'internal_error', message });
  }
}
