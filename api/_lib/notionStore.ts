/**
 * Capa de dominio: todo lo que la app necesita hacer con "las tareas del
 * día/semana y sus sesiones", expresado en términos del negocio y no de la
 * API de Notion. Hoy la única implementación habla con Notion (vía
 * notionClient.ts + notionPage.ts + sessionText.ts); el objetivo de tener
 * esta costura es que una futura migración a una base de datos real —o el
 * soporte multiusuario— cambie solo este archivo, sin tocar los endpoints.
 *
 * Los endpoints de `api/` se limitan a: extraer los campos de la request,
 * llamar acá, y traducir el resultado (o un ApiError) a HTTP.
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
  computeNextWeekRange,
  formatWeekLabel,
  isDateInRange,
  normalize,
  parseWeekRange,
  plainText,
  todayDateStringInTz,
  todayWeekdayNameInTz,
} from './parse.js';
import { formatSessionText, parseSessionText } from './sessionText.js';
import { resolveActivePageId, resolveFiles, richTextOf, type FileEntry } from './notionPage.js';
import { isValidTimeLabel, roundDurationSeconds } from '../../shared/duration.js';

const TIMEZONE = process.env.APP_TIMEZONE || 'America/El_Salvador';

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- Tipos de dominio (sin nada de Notion en las firmas públicas) ---

export type Session = {
  blockId: string | undefined;
  durationSeconds: number;
  start: string;
  end: string;
};

export type Task = {
  blockId: string;
  text: string;
  checked: boolean;
  day: string;
  sessions: Session[];
};

export type WeekSource = 'auto-matched' | 'auto-fallback' | 'requested';

export type WeekView = {
  week: string | null;
  weekSource: WeekSource;
  isCurrentWeek: boolean;
  previousWeekLabel: string | null;
  nextWeekLabel: string | null;
  availableDays: string[];
  selectedDay: string | null;
  dayMatched: boolean;
  dayContainerId: string | null;
  dayHeadingBlockId: string | null;
  tasks: Task[];
  weekTotalSeconds: number;
};

export type { FileEntry };

// --- Lectura de la vista semanal ---

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

export async function getWeekView(opts: {
  fileId?: string;
  week?: string;
  day?: string;
}): Promise<WeekView> {
  const activePageId = await resolveActivePageId(opts.fileId);
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
    // Página activa válida pero sin ninguna semana todavía (ej. un archivo
    // recién creado). No es un error — antes devolvía 404 y dejaba sin
    // forma de llegar al botón "+ Agregar semana".
    return {
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
    };
  }

  const today = todayDateStringInTz(TIMEZONE);
  // Un rango solo es válido si start <= end (protege contra encabezados con
  // typos, ej. "2026.08.03 - 2026.03.07").
  const hasValidRange = (w: WeekGroup): w is WeekGroup & { range: { start: string; end: string } } =>
    Boolean(w.range) && w.range!.start <= w.range!.end;

  const todayWeek = weeks.find(
    (w) => hasValidRange(w) && isDateInRange(today, w.range.start, w.range.end)
  );
  const requestedWeek = opts.week;

  let activeWeek: WeekGroup;
  // 'auto-matched': hoy cae exactamente dentro de un heading_1.
  // 'auto-fallback': no hay match exacto (ej. fin de semana entre dos
  //   semanas) y se usa una heurística — dispara el aviso en la UI.
  // 'requested': el usuario navegó explícitamente a otra semana — no
  //   dispara ningún aviso, fue intencional.
  let weekSource: WeekSource;

  if (requestedWeek) {
    const found = weeks.find((w) => w.label === requestedWeek);
    if (!found) {
      throw new NotFoundError('week_not_found', `No se encontró la semana "${requestedWeek}"`);
    }
    activeWeek = found;
    weekSource = 'requested';
  } else if (todayWeek) {
    activeWeek = todayWeek;
    weekSource = 'auto-matched';
  } else {
    // Preferir la semana ya terminada más reciente; si todas las semanas
    // con rango válido son futuras, la más próxima a empezar; si ninguna
    // semana tiene rango parseable, la primera del documento (por posición,
    // normalmente la más reciente en esta plantilla).
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
  // inicio), no por posición en el documento.
  const navigableWeeks = weeks
    .filter(hasValidRange)
    .sort((a, b) => (a.range.start < b.range.start ? -1 : a.range.start > b.range.start ? 1 : 0));
  const activeIndex = navigableWeeks.findIndex((w) => w === activeWeek);
  const previousWeekLabel = activeIndex > 0 ? navigableWeeks[activeIndex - 1].label : null;
  const nextWeekLabel =
    activeIndex >= 0 && activeIndex < navigableWeeks.length - 1
      ? navigableWeeks[activeIndex + 1].label
      : null;
  const isCurrentWeek = Boolean(todayWeek) && activeWeek === todayWeek;

  // 2. Dentro de la semana activa, agrupar to_do por heading_3 (día),
  //    aplanando columnas si la semana usa layout de columnas por día.
  const activeWeekBlocks = await expandColumns(activeWeek.blocks, activePageId);
  const dayOrder: string[] = [];
  const dayBlocks = new Map<string, NotionBlock[]>();
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
    // Semana válida pero sin desglose por día (ej. una semana de vacaciones
    // anotada solo con una nota). No es un error.
    return {
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
    };
  }

  const requestedDay = opts.day;
  const todayWeekday = todayWeekdayNameInTz(TIMEZONE);

  let selectedDay: string | undefined;
  let dayMatched: boolean;
  if (requestedDay) {
    selectedDay = dayOrder.find((d) => normalize(d) === normalize(requestedDay));
    dayMatched = Boolean(selectedDay);
  } else if (weekSource === 'requested') {
    // Se navegó explícitamente a otra semana: no tiene sentido buscar "el
    // día de hoy" ahí — se cae al primer día sin marcar "no encontrado".
    dayMatched = true;
  } else {
    selectedDay = dayOrder.find((d) => normalize(d) === todayWeekday);
    dayMatched = Boolean(selectedDay);
  }
  if (!selectedDay) selectedDay = dayOrder[0];

  // 3. Para cada to_do de la semana (todos los días, no solo el
  //    seleccionado), traer sus hijos (sesiones registradas). Se hace para
  //    toda la semana de una — no solo el día elegido — para calcular el
  //    total semanal sin pedirle a Notion los mismos bloques otra vez.
  const allTodoEntries = dayOrder.flatMap((day) =>
    (dayBlocks.get(day) ?? []).map((block) => ({ day, block }))
  );
  const allResults = await Promise.all(
    allTodoEntries.map(async ({ day, block }) => {
      const content = block.to_do as { rich_text?: { plain_text?: string }[]; checked?: boolean };
      const text = plainText(content?.rich_text);
      const checked = Boolean(content?.checked);

      let sessions: Session[] = [];
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

  const tasks: Task[] = allResults
    .filter((r) => r.day === selectedDay)
    .map(({ blockId, text, checked, sessions }) => ({
      blockId,
      text,
      checked,
      day: selectedDay as string,
      sessions,
    }));

  const weekTotalSeconds = allResults.reduce(
    (sum, r) => sum + r.sessions.reduce((s, ses) => s + ses.durationSeconds, 0),
    0
  );

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
    tasks,
    weekTotalSeconds,
  };
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

export async function suggestNextWeek(
  fileId?: string
): Promise<{ start: string; end: string; label: string }> {
  const activePageId = await resolveActivePageId(fileId);
  const { endDates } = await loadExistingWeeks(activePageId);
  const today = todayDateStringInTz(TIMEZONE);
  const { start, end } = computeNextWeekRange(endDates, today);
  return { start, end, label: formatWeekLabel(start, end) };
}

export async function createWeek(input: {
  start?: string;
  end?: string;
  fileId?: string;
}): Promise<{ label: string; start: string; end: string }> {
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

export async function listFiles(): Promise<FileEntry[]> {
  return resolveFiles();
}

// --- Tareas ---

export async function updateTask(input: {
  blockId?: string;
  checked?: boolean;
  text?: string;
}): Promise<{ checked: boolean | undefined; text: string | undefined }> {
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

export async function createTask(input: {
  containerId?: string;
  afterBlockId?: string;
  text?: string;
}): Promise<{ blockId: string; text: string; checked: false }> {
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

export async function deleteTask(blockId?: string): Promise<void> {
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
export async function reorderTask(input: {
  blockId?: string;
  containerId?: string;
  afterBlockId?: string;
}): Promise<{ newBlockId: string; warning?: 'stale_original_not_deleted' }> {
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

export async function logSession(input: {
  blockId?: string;
  durationSeconds?: number;
  // Timer en vivo: horas ISO completas, se formatean con la zona horaria configurada.
  startTime?: string;
  endTime?: string;
  // Registro manual: el usuario ya escribió la hora tal cual la quiere ver ("HH:MM").
  start?: string;
  end?: string;
}): Promise<Session> {
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

export async function updateSession(input: {
  blockId?: string;
  durationSeconds?: number;
  start?: string;
  end?: string;
}): Promise<Session> {
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

export async function deleteSession(blockId?: string): Promise<void> {
  if (!blockId || typeof blockId !== 'string') {
    throw new BadRequestError('invalid_block_id', 'Falta block_id');
  }
  await deleteBlock(blockId);
}
