import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth.js';
import { listBlockChildren, type NotionBlock } from './_lib/notion.js';
import { resolveActivePageId, richTextOf } from './_lib/notionPage.js';
import {
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

type PositionedBlock = { block: NotionBlock; parentId: string };

/**
 * La plantilla real organiza cada semana en columnas de Notion (un
 * `column_list` con un `column` por día), en vez de heading_3/to_do como
 * hermanos planos. Esto "aplana" esa estructura recursivamente para que el
 * agrupado por día funcione igual sin importar cuál de las dos formas use
 * la página. Solo se llama sobre la semana activa (no sobre todo el
 * historial), para no multiplicar las llamadas a la API de Notion.
 *
 * Se conserva el `parentId` real de cada bloque (la página, o el `column`
 * específico) — es el contenedor donde hay que insertar/agregar tareas
 * nuevas de ese día vía la API de Notion.
 */
async function expandColumns(
  blocks: NotionBlock[],
  parentId: string,
  depth = 0
): Promise<PositionedBlock[]> {
  if (depth > 3) return blocks.map((block) => ({ block, parentId }));
  const expanded: PositionedBlock[] = [];
  for (const block of blocks) {
    if (block.type === 'column_list' && block.has_children) {
      const columns = await listBlockChildren(block.id);
      for (const column of columns) {
        if (column.type === 'column' && column.has_children) {
          const columnChildren = await listBlockChildren(column.id);
          expanded.push(...(await expandColumns(columnChildren, column.id, depth + 1)));
        }
      }
    } else {
      expanded.push({ block, parentId });
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
    const fileId = typeof req.query.file === 'string' ? req.query.file : undefined;
    const activePageId = await resolveActivePageId(fileId);
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
      // Página activa válida pero sin ninguna semana todavía (ej. un
      // archivo recién creado). No es un error — antes devolvía 404 y
      // dejaba sin forma de llegar al botón "+ Agregar semana" (que vive
      // en la misma fila que solo se renderiza cuando hay `data`), un
      // callejón sin salida real para el primer uso de un archivo nuevo.
      return res.status(200).json({
        week: null,
        weekSource: 'auto-fallback',
        isCurrentWeek: false,
        previousWeekLabel: null,
        nextWeekLabel: null,
        availableDays: [],
        selectedDay: null,
        dayMatched: true,
        dayContainerId: null,
        dayHeadingBlockId: null,
        tasks: [],
        weekTotalSeconds: 0,
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
    const activeWeekBlocks = await expandColumns(activeWeek.blocks, activePageId);
    const dayOrder: string[] = [];
    const dayBlocks = new Map<string, NotionBlock[]>();
    // Dónde insertar tareas nuevas/reordenadas de cada día: el contenedor
    // real (página o columna) y el id del propio heading_3 como ancla para
    // "insertar al inicio" o cuando el día todavía no tiene ninguna tarea.
    const dayContainerId = new Map<string, string>();
    const dayHeadingBlockId = new Map<string, string>();
    let currentDayLabel: string | null = null;
    for (const { block, parentId } of activeWeekBlocks) {
      if (block.type === 'heading_3') {
        currentDayLabel = plainText(richTextOf(block));
        if (currentDayLabel && !dayOrder.includes(currentDayLabel)) {
          dayOrder.push(currentDayLabel);
          dayBlocks.set(currentDayLabel, []);
          dayContainerId.set(currentDayLabel, parentId);
          dayHeadingBlockId.set(currentDayLabel, block.id);
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
        dayContainerId: null,
        dayHeadingBlockId: null,
        tasks: [],
        weekTotalSeconds: 0,
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

    // 3. Para cada to_do de la semana (todos los días, no solo el
    //    seleccionado), traer sus hijos (sesiones ya registradas). Se hace
    //    para toda la semana de una — no solo el día elegido — para poder
    //    calcular el total semanal sin pedirle a Notion los mismos bloques
    //    otra vez día por día.
    const allTodoEntries = dayOrder.flatMap((day) => (dayBlocks.get(day) ?? []).map((block) => ({ day, block })));
    const allResults = await Promise.all(
      allTodoEntries.map(async ({ day, block }) => {
        const content = block.to_do as { rich_text?: { plain_text?: string }[]; checked?: boolean };
        const text = plainText(content?.rich_text);
        const checked = Boolean(content?.checked);

        let sessions: { blockId: string; durationSeconds: number; start: string; end: string }[] = [];
        if (block.has_children) {
          const children = await listBlockChildren(block.id);
          sessions = children
            .map((child) => {
              const parsed = parseSessionText(plainText(richTextOf(child)));
              return parsed ? { ...parsed, blockId: child.id } : null;
            })
            .filter((s): s is NonNullable<typeof s> => s !== null);
        }

        return { day, blockId: block.id, text, checked, sessions };
      })
    );

    const tasks = allResults
      .filter((r) => r.day === selectedDay)
      .map(({ blockId, text, checked, sessions }) => ({ blockId, text, checked, day: selectedDay as string, sessions }));

    const weekTotalSeconds = allResults.reduce(
      (sum, r) => sum + r.sessions.reduce((s, ses) => s + ses.durationSeconds, 0),
      0
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
      dayContainerId: dayContainerId.get(selectedDay) ?? null,
      dayHeadingBlockId: dayHeadingBlockId.get(selectedDay) ?? null,
      tasks,
      weekTotalSeconds,
    });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Error desconocido';
    return res.status(500).json({ error: 'internal_error', message });
  }
}
