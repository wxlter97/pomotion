/**
 * Implementación del `Store` (ver store.ts) contra Notion: arma la vista
 * semanal a partir de una plantilla de Notion y escribe las sesiones/tareas
 * de vuelta como bloques. Usa notionClient.ts (HTTP), notionPage.ts
 * (resolución de páginas), sessionText.ts (formato de sesión) y weekModel.ts
 * (heurísticas puras de qué semana/día mostrar).
 *
 * Los endpoints de `api/` solo hablan con el objeto `notionStore` de acá:
 * extraen los campos de la request, llaman, y traducen el resultado (o un
 * ApiError) a HTTP.
 */
import {
  appendBlockChildren,
  deleteBlock,
  getBlock,
  listBlockChildren,
  toRichTextRequest,
  updateParagraphText,
  updateToDo,
  type NotionBlock,
  type NotionRichText,
} from './notionClient.js';
import { BadRequestError, ConflictError, NotFoundError, UpstreamError } from './errors.js';
import {
  addDaysToDate,
  computeNextWeekRange,
  dateRangesOverlap,
  formatWeekLabel,
  isDateInRange,
  parseWeekRange,
  plainText,
  todayDateStringInTz,
  todayWeekdayNameInTz,
} from './parse.js';
import { formatSessionText, parseSessionText } from './sessionText.js';
import { resolveActivePageId, resolveFiles, richTextOf } from './notionPage.js';
import {
  computeWeekNav,
  hasValidRange,
  selectActiveWeek,
  selectDay,
  weekdayOffset,
  type WeekSummary,
} from './weekModel.js';
import { isValidTimeLabel, roundDurationSeconds } from '../../shared/duration.js';
import type {
  CreateTaskInput,
  CreateWeekInput,
  DayContainer,
  FileEntry,
  GetWeekViewInput,
  LogSessionInput,
  ReorderResult,
  ReorderTaskInput,
  ReportInput,
  Session,
  SessionRow,
  Store,
  Task,
  TaskFieldsUpdate,
  TaskRef,
  UpdateSessionInput,
  UpdateTaskInput,
  WeekRef,
  WeekSuggestion,
  WeekView,
} from './store.js';

const TIMEZONE = process.env.APP_TIMEZONE || 'America/El_Salvador';

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- Lectura de la vista semanal ---

type WeekGroup = {
  label: string;
  range: { start: string; end: string } | null;
  blocks: NotionBlock[];
};

type PositionedBlock = { block: NotionBlock; parentId: string };

type DayGrouping = {
  dayOrder: string[];
  dayBlocks: Map<string, NotionBlock[]>;
  dayContainerId: Map<string, string>;
  dayHeadingBlockId: Map<string, string>;
};

/** Agrupa los bloques de la página por heading_1 (cada uno = una semana). */
function groupBlocksByWeek(blocks: NotionBlock[]): WeekGroup[] {
  const weeks: WeekGroup[] = [];
  let current: WeekGroup | null = null;
  for (const block of blocks) {
    if (block.type === 'heading_1') {
      const label = plainText(richTextOf(block));
      current = { label, range: parseWeekRange(label), blocks: [] };
      weeks.push(current);
    } else if (current) {
      current.blocks.push(block);
    }
  }
  return weeks;
}

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
 * nuevas de ese día.
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

/** Agrupa los to_do de la semana activa por heading_3 (día), guardando
 *  dónde insertar tareas nuevas de cada día (contenedor + ancla). */
function groupPositionedBlocksByDay(positioned: PositionedBlock[]): DayGrouping {
  const dayOrder: string[] = [];
  const dayBlocks = new Map<string, NotionBlock[]>();
  const dayContainerId = new Map<string, string>();
  const dayHeadingBlockId = new Map<string, string>();
  let currentDay: string | null = null;
  for (const { block, parentId } of positioned) {
    if (block.type === 'heading_3') {
      currentDay = plainText(richTextOf(block));
      if (currentDay && !dayOrder.includes(currentDay)) {
        dayOrder.push(currentDay);
        dayBlocks.set(currentDay, []);
        dayContainerId.set(currentDay, parentId);
        dayHeadingBlockId.set(currentDay, block.id);
      }
    } else if (block.type === 'to_do' && currentDay) {
      dayBlocks.get(currentDay)?.push(block);
    }
  }
  return { dayOrder, dayBlocks, dayContainerId, dayHeadingBlockId };
}

/** Lee las sesiones (bloques hijos) de un to_do y las parsea. */
async function readSessions(block: NotionBlock): Promise<Session[]> {
  if (!block.has_children) return [];
  const children = await listBlockChildren(block.id);
  return children
    .map((child): Session | null => {
      const parsed = parseSessionText(plainText(richTextOf(child)));
      return parsed ? { ...parsed, blockId: child.id } : null;
    })
    .filter((s): s is Session => s !== null);
}

/** Forma de la vista cuando la página no tiene semanas todavía, o la semana
 *  activa no tiene desglose por día. */
function weekViewShell(overrides: Partial<WeekView> & Pick<WeekView, 'week' | 'weekSource'>): WeekView {
  return {
    isCurrentWeek: false,
    previousWeekLabel: null,
    nextWeekLabel: null,
    availableDays: [],
    selectedDay: null,
    dayMatched: true,
    dayContainerId: null,
    dayHeadingBlockId: null,
    dayContainers: [],
    tasks: [],
    weekTotalSeconds: 0,
    ...overrides,
  };
}

async function getWeekView(opts: GetWeekViewInput): Promise<WeekView> {
  const activePageId = await resolveActivePageId(opts.fileId);
  const weekGroups = groupBlocksByWeek(await listBlockChildren(activePageId));

  if (weekGroups.length === 0) {
    // Página activa válida pero sin ninguna semana todavía (ej. un archivo
    // recién creado). No es un error — antes devolvía 404 y dejaba sin
    // forma de llegar al botón "+ Agregar semana".
    return weekViewShell({ week: null, weekSource: 'auto-fallback' });
  }

  const today = todayDateStringInTz(TIMEZONE);
  const summaries: WeekSummary[] = weekGroups.map((w) => ({ label: w.label, range: w.range }));
  const { activeIndex, weekSource, todayWeekIndex } = selectActiveWeek(summaries, today, opts.week);
  if (activeIndex === -1) {
    throw new NotFoundError('week_not_found', `No se encontró la semana "${opts.week}"`);
  }
  const activeWeek = weekGroups[activeIndex];
  const isCurrentWeek = todayWeekIndex !== -1 && todayWeekIndex === activeIndex;
  const { previousWeekLabel, nextWeekLabel } = computeWeekNav(summaries, activeIndex);

  const positioned = await expandColumns(activeWeek.blocks, activePageId);
  const { dayOrder, dayBlocks, dayContainerId, dayHeadingBlockId } =
    groupPositionedBlocksByDay(positioned);

  if (dayOrder.length === 0) {
    // Semana válida pero sin desglose por día (ej. una semana de vacaciones
    // anotada solo con una nota). No es un error.
    return weekViewShell({
      week: activeWeek.label,
      weekSource,
      isCurrentWeek,
      previousWeekLabel,
      nextWeekLabel,
    });
  }

  const { selectedDay, dayMatched } = selectDay(dayOrder, {
    requestedDay: opts.day,
    weekSource,
    todayWeekday: todayWeekdayNameInTz(TIMEZONE),
  });

  // Se traen las sesiones de TODOS los días de la semana (no solo el
  // seleccionado) para calcular el total semanal sin pedirle a Notion los
  // mismos bloques otra vez día por día.
  const allEntries = dayOrder.flatMap((day) =>
    (dayBlocks.get(day) ?? []).map((block) => ({ day, block }))
  );
  const allResults = await Promise.all(
    allEntries.map(async ({ day, block }) => {
      const content = block.to_do as { rich_text?: { plain_text?: string }[]; checked?: boolean };
      return {
        day,
        blockId: block.id,
        text: plainText(content?.rich_text),
        checked: Boolean(content?.checked),
        sessions: await readSessions(block),
      };
    })
  );

  const tasks: Task[] = allResults
    .filter((r) => r.day === selectedDay)
    .map(({ blockId, text, checked, sessions }) => ({ blockId, text, checked, day: selectedDay, sessions }));

  const weekTotalSeconds = allResults.reduce(
    (sum, r) => sum + r.sessions.reduce((s, ses) => s + ses.durationSeconds, 0),
    0
  );

  // Contenedor + ancla de cada día de la semana (no solo el seleccionado) —
  // habilita mover una tarea a otro día sin cambiar de vista.
  const dayContainers: DayContainer[] = dayOrder.flatMap((day) => {
    const containerId = dayContainerId.get(day);
    const headingBlockId = dayHeadingBlockId.get(day);
    return containerId && headingBlockId ? [{ day, containerId, headingBlockId }] : [];
  });

  return {
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
    dayContainers,
    tasks,
    weekTotalSeconds,
  };
}

// --- Reporte de tiempo por rango de fechas ---

async function getSessionsInRange(input: ReportInput): Promise<SessionRow[]> {
  const { from, to, fileId } = input;
  if (!from || !DATE_RE.test(from)) {
    throw new BadRequestError('invalid_from', 'from debe ser "YYYY-MM-DD"');
  }
  if (!to || !DATE_RE.test(to)) {
    throw new BadRequestError('invalid_to', 'to debe ser "YYYY-MM-DD"');
  }
  if (to < from) {
    throw new BadRequestError('invalid_range', 'to no puede ser antes que from');
  }

  const activePageId = await resolveActivePageId(fileId);
  const weekGroups = groupBlocksByWeek(await listBlockChildren(activePageId));

  const rows: SessionRow[] = [];
  for (const week of weekGroups) {
    // Solo las semanas con rango parseable que se solapan con [from, to] —
    // cada sesión se fecha por su semana (lunes) + su día.
    if (!hasValidRange(week)) continue;
    const weekRange = week.range;
    if (!dateRangesOverlap(weekRange.start, weekRange.end, from, to)) continue;

    const positioned = await expandColumns(week.blocks, activePageId);
    const { dayOrder, dayBlocks } = groupPositionedBlocksByDay(positioned);

    for (const day of dayOrder) {
      const date = addDaysToDate(weekRange.start, weekdayOffset(day) ?? 0);
      if (!isDateInRange(date, from, to)) continue;

      for (const block of dayBlocks.get(day) ?? []) {
        const content = block.to_do as { rich_text?: { plain_text?: string }[] };
        const task = plainText(content?.rich_text);
        for (const session of await readSessions(block)) {
          rows.push({
            date,
            day,
            week: week.label,
            task,
            durationSeconds: session.durationSeconds,
            start: session.start,
            end: session.end,
          });
        }
      }
    }
  }

  rows.sort((a, b) => (a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)));
  return rows;
}

// --- Semanas ---

type ExistingWeeks = {
  labels: string[];
  endDates: string[];
  /** Bloque justo antes del primer heading_1 — ancla para insertar la
   *  semana nueva al tope de la lista, no al final de la página. */
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

async function suggestNextWeek(fileId?: string): Promise<WeekSuggestion> {
  const activePageId = await resolveActivePageId(fileId);
  const { endDates } = await loadExistingWeeks(activePageId);
  const today = todayDateStringInTz(TIMEZONE);
  const { start, end } = computeNextWeekRange(endDates, today);
  return { start, end, label: formatWeekLabel(start, end) };
}

async function createWeek(input: CreateWeekInput): Promise<WeekRef> {
  const { start, end, fileId } = input;

  if (!start || !DATE_RE.test(start)) {
    throw new BadRequestError('invalid_start', 'start debe ser "YYYY-MM-DD"');
  }
  if (!end || !DATE_RE.test(end)) {
    throw new BadRequestError('invalid_end', 'end debe ser "YYYY-MM-DD"');
  }
  if (end < start) {
    throw new BadRequestError('invalid_range', 'end no puede ser antes que start');
  }

  const label = formatWeekLabel(start, end);
  const activePageId = await resolveActivePageId(fileId);
  const { labels, topAnchorBlockId } = await loadExistingWeeks(activePageId);

  if (labels.includes(label)) {
    throw new ConflictError('week_exists', `Ya existe una semana "${label}"`);
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

  return { label, start, end };
}

// --- Archivos ---

function listFiles(): Promise<FileEntry[]> {
  return resolveFiles();
}

// --- Tareas ---

async function updateTask(input: UpdateTaskInput): Promise<TaskFieldsUpdate> {
  const { blockId, checked, text } = input;

  if (!blockId || typeof blockId !== 'string') {
    throw new BadRequestError('invalid_block_id', 'Falta block_id');
  }
  if (checked === undefined && text === undefined) {
    throw new BadRequestError('nothing_to_update', 'Nada que actualizar');
  }
  if (checked !== undefined && typeof checked !== 'boolean') {
    throw new BadRequestError('invalid_checked', 'checked debe ser booleano');
  }

  let trimmedText: string | undefined;
  if (text !== undefined) {
    trimmedText = typeof text === 'string' ? text.trim() : '';
    if (!trimmedText) {
      throw new BadRequestError('invalid_text', 'El texto no puede estar vacío');
    }
  }

  await updateToDo(blockId, { checked, text: trimmedText });
  return { checked, text: trimmedText };
}

async function createTask(input: CreateTaskInput): Promise<TaskRef> {
  const { containerId, afterBlockId, text } = input;

  if (!containerId || typeof containerId !== 'string') {
    throw new BadRequestError('invalid_container_id', 'Falta container_id');
  }
  if (!afterBlockId || typeof afterBlockId !== 'string') {
    throw new BadRequestError('invalid_after_block_id', 'Falta after_block_id');
  }
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) {
    throw new BadRequestError('invalid_text', 'El texto no puede estar vacío');
  }

  const result = (await appendBlockChildren(
    containerId,
    [{ to_do: { rich_text: [{ type: 'text', text: { content: trimmed } }], checked: false } }],
    afterBlockId
  )) as { results?: { id?: string }[] };
  const blockId = result?.results?.[0]?.id;
  if (!blockId) {
    throw new UpstreamError('notion_no_id', 'Notion no devolvió el id del bloque creado');
  }

  return { blockId, text: trimmed, checked: false };
}

async function deleteTask(blockId?: string): Promise<void> {
  if (!blockId || typeof blockId !== 'string') {
    throw new BadRequestError('invalid_block_id', 'Falta block_id');
  }
  await deleteBlock(blockId);
}

/**
 * Notion no tiene un endpoint para "mover" un bloque. La única forma de
 * reordenar es crear un bloque nuevo en la posición destino (copiando
 * texto, checked, y las sesiones registradas como hijos) y borrar el
 * original.
 *
 * Orden seguro para no perder datos si algo falla a la mitad:
 *   1. Leer el bloque original y sus hijos (sesiones).
 *   2. Crear el bloque nuevo en la posición destino.
 *   3. Copiar las sesiones al bloque nuevo — si esto falla, borrar el
 *      bloque nuevo recién creado.
 *   4. Solo ahora, borrar el bloque original. Si justo este paso falla, el
 *      bloque nuevo ya tiene todo correcto — se devuelve OK con un aviso de
 *      duplicado viejo, no un error.
 * Un fallo en los pasos 1-2 deja el original intacto (no-op seguro).
 */
async function reorderTask(input: ReorderTaskInput): Promise<ReorderResult> {
  const { blockId, containerId, afterBlockId } = input;

  if (!blockId || typeof blockId !== 'string') {
    throw new BadRequestError('invalid_block_id', 'Falta block_id');
  }
  if (!containerId || typeof containerId !== 'string') {
    throw new BadRequestError('invalid_container_id', 'Falta container_id');
  }
  if (!afterBlockId || typeof afterBlockId !== 'string') {
    throw new BadRequestError('invalid_after_block_id', 'Falta after_block_id');
  }
  if (afterBlockId === blockId) {
    throw new BadRequestError('invalid_after_block_id', 'No puede ir después de sí misma');
  }

  const original = await getBlock(blockId);
  if (original.type !== 'to_do') {
    throw new BadRequestError('not_a_todo', 'El bloque no es una tarea');
  }
  const originalToDo = original.to_do as {
    rich_text?: NotionRichText[];
    checked?: boolean;
    color?: string;
  };

  let childrenToCopy: Awaited<ReturnType<typeof listBlockChildren>> = [];
  if (original.has_children) {
    childrenToCopy = await listBlockChildren(blockId);
    const unsupported = childrenToCopy.find((c) => c.type !== 'paragraph');
    if (unsupported) {
      throw new ConflictError(
        'unsupported_child_block',
        `Esta tarea tiene un bloque hijo de tipo "${unsupported.type}" que no se puede mover automáticamente. Ajústalo manualmente en Notion antes de reordenar.`
      );
    }
  }

  const createResult = (await appendBlockChildren(
    containerId,
    [
      {
        to_do: {
          rich_text: toRichTextRequest(originalToDo.rich_text ?? []),
          checked: Boolean(originalToDo.checked),
          color: originalToDo.color ?? 'default',
        },
      },
    ],
    afterBlockId
  )) as { results?: { id?: string }[] };
  const newBlockId = createResult?.results?.[0]?.id;
  if (!newBlockId) {
    throw new UpstreamError('notion_no_id', 'Notion no devolvió el id del bloque nuevo');
  }

  if (childrenToCopy.length > 0) {
    try {
      const childrenPayload = childrenToCopy.map((child) => ({
        paragraph: {
          rich_text: toRichTextRequest(
            (child.paragraph as { rich_text?: NotionRichText[] } | undefined)?.rich_text ?? []
          ),
        },
      }));
      await appendBlockChildren(newBlockId, childrenPayload);
    } catch (err) {
      try {
        await deleteBlock(newBlockId);
      } catch {
        // best-effort rollback — si esto también falla, queda un duplicado
        // a medias; se prioriza propagar el error original.
      }
      throw err;
    }
  }

  try {
    await deleteBlock(blockId);
  } catch (err) {
    console.error('reorderTask: se creó el reemplazo pero falló borrar el original', err);
    return { newBlockId, warning: 'stale_original_not_deleted' };
  }

  return { newBlockId };
}

// --- Sesiones ---

function formatTimeFromIso(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Fecha inválida: "${iso}"`);
  }
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

async function logSession(input: LogSessionInput): Promise<Session> {
  const { blockId, durationSeconds, startTime, endTime, start, end } = input;

  if (!blockId || typeof blockId !== 'string') {
    throw new BadRequestError('invalid_block_id', 'Falta block_id');
  }
  if (
    typeof durationSeconds !== 'number' ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    throw new BadRequestError('invalid_duration', 'duration_seconds inválido');
  }

  let startLabel: string;
  let endLabel: string;
  if (startTime && endTime) {
    startLabel = formatTimeFromIso(startTime);
    endLabel = formatTimeFromIso(endTime);
  } else if (start && end) {
    if (!isValidTimeLabel(start) || !isValidTimeLabel(end)) {
      throw new BadRequestError('invalid_time', 'start/end deben ser "HH:MM"');
    }
    startLabel = start;
    endLabel = end;
  } else {
    throw new BadRequestError('missing_time_range', 'Faltan start_time/end_time o start/end');
  }

  const roundedSeconds = roundDurationSeconds(durationSeconds);
  const text = formatSessionText(roundedSeconds, startLabel, endLabel);

  const result = (await appendBlockChildren(blockId, [
    { paragraph: { rich_text: [{ type: 'text', text: { content: text } }] } },
  ])) as { results?: { id?: string }[] };
  const sessionBlockId = result?.results?.[0]?.id;

  return { blockId: sessionBlockId, durationSeconds: roundedSeconds, start: startLabel, end: endLabel };
}

async function updateSession(input: UpdateSessionInput): Promise<Session> {
  const { blockId, durationSeconds, start, end } = input;

  if (!blockId || typeof blockId !== 'string') {
    throw new BadRequestError('invalid_block_id', 'Falta block_id');
  }
  if (
    typeof durationSeconds !== 'number' ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    throw new BadRequestError('invalid_duration', 'duration_seconds inválido');
  }
  if (!start || !end || !isValidTimeLabel(start) || !isValidTimeLabel(end)) {
    throw new BadRequestError('invalid_time', 'start/end deben ser "HH:MM"');
  }

  const roundedSeconds = roundDurationSeconds(durationSeconds);
  const text = formatSessionText(roundedSeconds, start, end);
  await updateParagraphText(blockId, text);

  return { blockId, durationSeconds: roundedSeconds, start, end };
}

async function deleteSession(blockId?: string): Promise<void> {
  if (!blockId || typeof blockId !== 'string') {
    throw new BadRequestError('invalid_block_id', 'Falta block_id');
  }
  await deleteBlock(blockId);
}

export const notionStore: Store = {
  getWeekView,
  getSessionsInRange,
  suggestNextWeek,
  createWeek,
  listFiles,
  updateTask,
  createTask,
  deleteTask,
  reorderTask,
  logSession,
  updateSession,
  deleteSession,
};
