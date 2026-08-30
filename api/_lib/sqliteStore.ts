/**
 * Implementación de `TaskStore` (ver taskStore.ts) contra Turso / libSQL.
 * Toda query se scopea a `currentUserId()` (ver requestContext.ts). Sin
 * transacciones distribuidas: los pocos casos multi-statement usan
 * `db.batch(..., 'write')`.
 */
import crypto from 'node:crypto';
import type { InValue, Row } from '@libsql/client';
import { BadRequestError, ConflictError, NotFoundError } from './errors.js';
import { getDb } from './db.js';
import {
  addDaysToDate,
  addMonths,
  isValidMonth,
  monthRange,
  normalize,
  todayDateStringInTz,
} from './parse.js';
import { computeAnalytics } from './analytics.js';
import { ACCOUNT_NONEMPTY_TABLES, BACKUP_TABLES, buildInserts, parseBackup, remapIds } from './backup.js';
import {
  desiredTasksFromEvents,
  fetchIcalText,
  isoDateUtc,
  parseIcalEvents,
  planSync,
  syncWindow,
  SYNC_DEBOUNCE_MS,
  type FeedTaskRow,
} from './calendarSync.js';
import { currentUserId } from './requestContext.js';
import {
  WEEKDAY_NAMES,
  mondayOf,
  resolveWeekStart,
  selectDay,
  toWeekday,
  weekDates,
  weekLabelOf,
  weekdayIndex,
  weekdayNameOf,
} from './weekDates.js';
import { isValidTimeLabel, roundDurationSeconds } from '../../shared/duration.js';
import type {
  Analytics,
  ApplyDayTemplateInput,
  Backup,
  BackupValue,
  BulkResult,
  BulkTasksInput,
  ImportResult,
  ApplyRecurringInput,
  CalendarFeed,
  CreateCalendarFeedInput,
  CreateDayTemplateInput,
  CreateGoalInput,
  CreateRecurringRuleInput,
  CreateTagInput,
  CreateTaskInput,
  DayTemplate,
  DayTemplateItem,
  DayTemplateItemInput,
  FileEntry,
  FocusHeatmap,
  FocusHeatmapDay,
  GetAnalyticsInput,
  GetFocusHeatmapInput,
  Goal,
  GoalProgress,
  GetMonthSummaryInput,
  GetWeekViewInput,
  LogSessionInput,
  MonthDaySummary,
  MonthSummary,
  RecurringRule,
  ReportInput,
  Session,
  SessionRow,
  SyncCalendarResult,
  SearchTasksInput,
  Tag,
  Task,
  TaskPriority,
  TaskSearchResult,
  TaskStore,
  UpdateCalendarFeedInput,
  UpdateDayTemplateInput,
  UpdateGoalInput,
  UpdateRecurringRuleInput,
  UpdateSessionInput,
  UpdateTagInput,
  UpdateTaskInput,
  UpdateTaskPositionInput,
  UpdateTaskResult,
  WeekView,
} from './taskStore.js';

const TIMEZONE = process.env.APP_TIMEZONE || 'America/El_Salvador';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS_RE = /^[1-7](,[1-7])*$/;

// --- Mappers ---

function toSession(r: Row): Session {
  return {
    id: String(r.id),
    taskId: String(r.task_id),
    durationSeconds: Number(r.duration_sec),
    start: String(r.start_hhmm),
    end: String(r.end_hhmm),
  };
}

const PRIORITIES = new Set(['low', 'med', 'high']);

// Paleta de etiquetas — mantener en sync con src/tags.ts.
const TAG_COLORS = new Set([
  'slate',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'violet',
  'pink',
]);
const DEFAULT_TAG_COLOR = 'slate';
const TAG_NAME_MAX = 40;

function toTask(r: Row, sessions: Session[], tagIds: string[] = []): Task {
  const priority = r.priority == null ? null : String(r.priority);
  const notes = r.notes == null ? null : String(r.notes);
  return {
    id: String(r.id),
    name: String(r.name),
    date: r.date == null ? null : String(r.date),
    done: Number(r.done) === 1,
    order: Number(r.order),
    file: r.file == null ? null : String(r.file),
    priority: priority && PRIORITIES.has(priority) ? (priority as TaskPriority) : null,
    notes: notes && notes.length > 0 ? notes : null,
    due: r.due == null ? null : String(r.due),
    estimateMinutes: r.estimate_min == null ? null : Number(r.estimate_min),
    tagIds,
    source: String(r.source ?? 'manual') === 'calendar' ? 'calendar' : 'manual',
    createdAt: String(r.created_at),
    sessions,
  };
}

function toTag(r: Row): Tag {
  const color = r.color == null ? DEFAULT_TAG_COLOR : String(r.color);
  return {
    id: String(r.id),
    name: String(r.name),
    color: TAG_COLORS.has(color) ? color : DEFAULT_TAG_COLOR,
  };
}

/** `SELECT task_id, tag_id` para un set de tareas → Map<taskId, tagId[]>. */
async function tagIdsByTask(taskIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (taskIds.length === 0) return map;
  const placeholders = taskIds.map(() => '?').join(',');
  const rows = (
    await getDb().execute({
      sql: `SELECT task_id, tag_id FROM task_tags WHERE task_id IN (${placeholders})`,
      args: taskIds,
    })
  ).rows;
  for (const r of rows) {
    const t = String(r.task_id);
    (map.get(t) ?? map.set(t, []).get(t)!).push(String(r.tag_id));
  }
  return map;
}

function toRule(r: Row): RecurringRule {
  return {
    id: String(r.id),
    name: String(r.name),
    file: r.file == null ? null : String(r.file),
    weekdays: String(r.weekdays),
    active: Number(r.active) === 1,
  };
}

/** `file = ?` / `file IS NULL` + los args correspondientes. */
function fileFilter(fileId: string | undefined, column = 'file'): { clause: string; args: InValue[] } {
  return fileId
    ? { clause: `${column} = ?`, args: [fileId] }
    : { clause: `${column} IS NULL`, args: [] };
}

/** `date = ?` / `date IS NULL` (para el inbox) + los args correspondientes. */
function dateEq(date: string | null): { clause: string; args: InValue[] } {
  return date == null ? { clause: 'date IS NULL', args: [] } : { clause: 'date = ?', args: [date] };
}

function formatTimeFromIso(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestError('invalid_time', `Fecha inválida: "${iso}"`);
  }
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

// --- Orden fraccional dentro de un día ---
//
// `afterId`: `undefined` → al final del día; `null` → al inicio;
// un id → justo después de esa tarea (punto medio con la siguiente).

async function computeOrder(
  userId: string,
  date: string | null,
  file: string | null,
  afterId: string | null | undefined
): Promise<number> {
  const db = getDb();
  const f = fileFilter(file ?? undefined);
  const d = dateEq(date);
  const scope = `user_id = ? AND ${f.clause} AND ${d.clause}`;
  const scopeArgs = [userId, ...f.args, ...d.args];

  if (afterId === undefined) {
    const max = (
      await db.execute({
        sql: `SELECT max("order") AS o FROM tasks WHERE ${scope}`,
        args: scopeArgs,
      })
    ).rows[0]?.o;
    return (max == null ? 0 : Number(max)) + 1;
  }

  if (afterId === null) {
    const min = (
      await db.execute({
        sql: `SELECT min("order") AS o FROM tasks WHERE ${scope}`,
        args: scopeArgs,
      })
    ).rows[0]?.o;
    return (min == null ? 1 : Number(min)) - 1;
  }

  const after = (
    await db.execute({
      sql: 'SELECT "order" AS o FROM tasks WHERE id = ? AND user_id = ?',
      args: [afterId, userId],
    })
  ).rows[0]?.o;

  if (after == null) {
    const max = (
      await db.execute({
        sql: `SELECT max("order") AS o FROM tasks WHERE ${scope}`,
        args: scopeArgs,
      })
    ).rows[0]?.o;
    return (max == null ? 0 : Number(max)) + 1;
  }

  const afterOrder = Number(after);
  const next = (
    await db.execute({
      sql: `SELECT min("order") AS o FROM tasks WHERE ${scope} AND "order" > ?`,
      args: [...scopeArgs, afterOrder],
    })
  ).rows[0]?.o;
  return next == null ? afterOrder + 1 : (afterOrder + Number(next)) / 2;
}

// --- Vista semanal ---

async function getWeekView(input: GetWeekViewInput): Promise<WeekView> {
  const userId = currentUserId();
  const weekStart = resolveWeekStart(input.week, TIMEZONE);
  const dates = weekDates(weekStart);
  const today = todayDateStringInTz(TIMEZONE);
  const thisMonday = mondayOf(today);
  const isCurrentWeek = weekStart === thisMonday;
  const selectedDay = selectDay({ requestedDay: input.day, isCurrentWeek, timeZone: TIMEZONE });
  const selectedDate = dates[weekdayIndex(selectedDay) ?? 0];

  const f = fileFilter(input.fileId);
  const db = getDb();

  // Materializar las reglas recurrentes al abrir la semana (actual o futura),
  // una sola vez por semana y contexto. Best-effort: si algo falla (p. ej. la
  // migración de `recurring_runs` todavía no corrió en prod), la vista igual
  // se sirve.
  if (weekStart >= thisMonday) {
    try {
      await autoApplyRecurring(userId, weekStart, input.fileId ?? null);
    } catch (err) {
      console.error('autoApplyRecurring falló:', err);
    }
  }

  const taskRows = (
    await db.execute({
      sql: `SELECT * FROM tasks
            WHERE user_id = ? AND ${f.clause} AND date >= ? AND date <= ?
            ORDER BY date, "order", created_at`,
      args: [userId, ...f.args, dates[0], dates[4]],
    })
  ).rows;

  const sessRows = (
    await db.execute({
      sql: `SELECT * FROM work_sessions
            WHERE user_id = ? AND ${f.clause} AND date >= ? AND date <= ?
            ORDER BY start_hhmm`,
      args: [userId, ...f.args, dates[0], dates[4]],
    })
  ).rows;

  const sessionsByTask = new Map<string, Session[]>();
  for (const r of sessRows) {
    const s = toSession(r);
    const list = sessionsByTask.get(s.taskId);
    if (list) list.push(s);
    else sessionsByTask.set(s.taskId, [s]);
  }

  const dayRows = taskRows.filter((r) => String(r.date) === selectedDate);

  // Inbox: tareas sin fecha del contexto actual (independiente de la semana).
  const inboxRows = (
    await db.execute({
      sql: `SELECT * FROM tasks
            WHERE user_id = ? AND ${f.clause} AND date IS NULL
            ORDER BY "order", created_at`,
      args: [userId, ...f.args],
    })
  ).rows;

  const tagsByTask = await tagIdsByTask([...dayRows, ...inboxRows].map((r) => String(r.id)));
  const tasks = dayRows.map((r) =>
    toTask(r, sessionsByTask.get(String(r.id)) ?? [], tagsByTask.get(String(r.id)) ?? [])
  );
  const inbox = inboxRows.map((r) => toTask(r, [], tagsByTask.get(String(r.id)) ?? []));
  const tags = (
    await db.execute({
      sql: 'SELECT * FROM tags WHERE user_id = ? ORDER BY name COLLATE NOCASE',
      args: [userId],
    })
  ).rows.map(toTag);

  const dayTemplates = await listDayTemplatesFor(userId);

  // Aviso de vencimientos: tareas sin hacer del contexto que vencen hoy o antes.
  const dueReminders = (
    await db.execute({
      sql: `SELECT id, name, due FROM tasks
            WHERE user_id = ? AND ${f.clause} AND done = 0 AND due IS NOT NULL AND due <= ?
            ORDER BY due LIMIT 20`,
      args: [userId, ...f.args, today],
    })
  ).rows.map((r) => ({ id: String(r.id), name: String(r.name), due: String(r.due) }));

  const dayTotalSeconds = sessRows
    .filter((r) => String(r.date) === selectedDate)
    .reduce((sum, r) => sum + Number(r.duration_sec), 0);
  const weekTotalSeconds = sessRows.reduce((sum, r) => sum + Number(r.duration_sec), 0);

  return {
    week: weekLabelOf(weekStart),
    weekStart,
    isCurrentWeek,
    previousWeekLabel: weekLabelOf(addDaysToDate(weekStart, -7)),
    nextWeekLabel: weekLabelOf(addDaysToDate(weekStart, 7)),
    days: WEEKDAY_NAMES.map((day, i) => ({ day, date: dates[i] })),
    selectedDay,
    selectedDate,
    today,
    tasks,
    inbox,
    tags,
    dayTemplates,
    dayTotalSeconds,
    weekTotalSeconds,
    carryOverCount: await countCarryOver(userId, input.fileId),
    dueReminders,
  };
}

// Ventana de "arrastre": solo tareas de los últimos 14 días cuentan como
// "se me pasó". Más viejas = abandonadas, no se traen.
const CARRY_OVER_WINDOW_DAYS = 14;

/** Tareas pendientes (done=0, sin sesiones) de un día anterior a hoy dentro
 *  de la ventana: las candidatas a "traer a hoy". */
async function countCarryOver(userId: string, fileId: string | undefined): Promise<number> {
  const f = fileFilter(fileId);
  const target = toWeekday(todayDateStringInTz(TIMEZONE));
  const row = (
    await getDb().execute({
      sql: `SELECT count(*) AS c FROM tasks t
            WHERE t.user_id = ? AND ${f.clause} AND t.done = 0 AND t.date IS NOT NULL
              AND t.date < ? AND t.date >= ?
              AND NOT EXISTS (SELECT 1 FROM work_sessions ws WHERE ws.task_id = t.id)`,
      args: [userId, ...f.args, target, addDaysToDate(target, -CARRY_OVER_WINDOW_DAYS)],
    })
  ).rows[0];
  return Number(row?.c ?? 0);
}

/** Mueve a hoy las tareas pendientes sin sesiones de los últimos
 *  CARRY_OVER_WINDOW_DAYS, preservando su orden relativo (más viejas primero). */
async function carryOverToToday(input: { fileId?: string }): Promise<{ moved: number }> {
  const userId = currentUserId();
  // Si hoy es fin de semana, se traen al lunes siguiente (la vista es Lun–Vie).
  const target = toWeekday(todayDateStringInTz(TIMEZONE));
  const f = fileFilter(input.fileId);
  const db = getDb();

  const rows = (
    await db.execute({
      sql: `SELECT t.id FROM tasks t
            WHERE t.user_id = ? AND ${f.clause} AND t.done = 0 AND t.date IS NOT NULL
              AND t.date < ? AND t.date >= ?
              AND NOT EXISTS (SELECT 1 FROM work_sessions ws WHERE ws.task_id = t.id)
            ORDER BY t.date, t."order", t.created_at`,
      args: [userId, ...f.args, target, addDaysToDate(target, -CARRY_OVER_WINDOW_DAYS)],
    })
  ).rows;
  if (rows.length === 0) return { moved: 0 };

  const maxOrder = Number(
    (
      await db.execute({
        sql: `SELECT max("order") AS o FROM tasks WHERE user_id = ? AND ${f.clause} AND date = ?`,
        args: [userId, ...f.args, target],
      })
    ).rows[0]?.o ?? 0
  );

  const now = new Date().toISOString();
  await db.batch(
    rows.map((r, i) => ({
      sql: 'UPDATE tasks SET date = ?, "order" = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      args: [target, maxOrder + i + 1, now, String(r.id), userId],
    })),
    'write'
  );
  return { moved: rows.length };
}

// --- Vista mensual ---

/** Resumen por día del mes: cuántas tareas (y cuántas hechas) y cuántos
 *  segundos registrados. Solo devuelve los días con actividad — el cliente
 *  arma la grilla del calendario. 2 queries agregadas. */
async function getMonthSummary(input: GetMonthSummaryInput): Promise<MonthSummary> {
  const userId = currentUserId();
  const today = todayDateStringInTz(TIMEZONE);
  const month = input.month && isValidMonth(input.month) ? input.month : today.slice(0, 7);
  const { first, last } = monthRange(month);
  const f = fileFilter(input.fileId);
  const db = getDb();

  const taskRows = (
    await db.execute({
      sql: `SELECT date, count(*) AS tasks, sum(done) AS done FROM tasks
            WHERE user_id = ? AND ${f.clause} AND date >= ? AND date <= ?
            GROUP BY date`,
      args: [userId, ...f.args, first, last],
    })
  ).rows;

  const sessRows = (
    await db.execute({
      sql: `SELECT date, sum(duration_sec) AS secs FROM work_sessions
            WHERE user_id = ? AND ${f.clause} AND date >= ? AND date <= ?
            GROUP BY date`,
      args: [userId, ...f.args, first, last],
    })
  ).rows;

  const byDate = new Map<string, MonthDaySummary>();
  for (const r of taskRows) {
    const date = String(r.date);
    byDate.set(date, {
      date,
      taskCount: Number(r.tasks),
      doneCount: Number(r.done ?? 0),
      totalSeconds: 0,
    });
  }
  for (const r of sessRows) {
    const date = String(r.date);
    const entry = byDate.get(date) ?? { date, taskCount: 0, doneCount: 0, totalSeconds: 0 };
    entry.totalSeconds = Number(r.secs ?? 0);
    byDate.set(date, entry);
  }

  return {
    month,
    previousMonth: addMonths(month, -1),
    nextMonth: addMonths(month, 1),
    isCurrentMonth: month === today.slice(0, 7),
    today: today.slice(0, 7) === month ? today : null,
    days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// --- Heatmap de foco ---

const HEATMAP_DEFAULT_WEEKS = 26;
const HEATMAP_MIN_WEEKS = 4;
const HEATMAP_MAX_WEEKS = 53;

function clampWeeks(weeks: number | undefined): number {
  if (typeof weeks !== 'number' || !Number.isFinite(weeks)) return HEATMAP_DEFAULT_WEEKS;
  return Math.min(HEATMAP_MAX_WEEKS, Math.max(HEATMAP_MIN_WEEKS, Math.round(weeks)));
}

/** Segundos registrados por día en las últimas N semanas (columnas del
 *  heatmap estilo GitHub). 1 query agregada; solo devuelve los días con
 *  actividad — el cliente arma la grilla. */
async function getFocusHeatmap(input: GetFocusHeatmapInput): Promise<FocusHeatmap> {
  const userId = currentUserId();
  const today = todayDateStringInTz(TIMEZONE);
  const weeks = clampWeeks(input.weeks);
  // La última columna es la semana (Lun–Dom) que contiene hoy; la primera
  // empieza (weeks - 1) semanas antes, siempre un lunes.
  const startDate = addDaysToDate(mondayOf(today), -(weeks - 1) * 7);
  const f = fileFilter(input.fileId);

  const rows = (
    await getDb().execute({
      sql: `SELECT date, sum(duration_sec) AS secs FROM work_sessions
            WHERE user_id = ? AND ${f.clause} AND date >= ? AND date <= ?
            GROUP BY date
            ORDER BY date`,
      args: [userId, ...f.args, startDate, today],
    })
  ).rows;

  const days: FocusHeatmapDay[] = rows
    .map((r) => ({ date: String(r.date), totalSeconds: Number(r.secs ?? 0) }))
    .filter((d) => d.totalSeconds > 0);

  return {
    startDate,
    endDate: today,
    today,
    weeks,
    totalSeconds: days.reduce((sum, d) => sum + d.totalSeconds, 0),
    activeDays: days.length,
    maxSeconds: days.reduce((max, d) => Math.max(max, d.totalSeconds), 0),
    days,
  };
}

// --- Analítica ---

const ANALYTICS_DEFAULT_WEEKS = 12;

function clampAnalyticsWeeks(weeks: number | undefined): number {
  if (typeof weeks !== 'number' || !Number.isFinite(weeks)) return ANALYTICS_DEFAULT_WEEKS;
  return Math.min(52, Math.max(4, Math.round(weeks)));
}

/** Agregados del panel de analítica. 2 queries (sesiones + tareas de la
 *  ventana); el cálculo lo hace `computeAnalytics` (puro). */
async function getAnalytics(input: GetAnalyticsInput): Promise<Analytics> {
  const userId = currentUserId();
  const today = todayDateStringInTz(TIMEZONE);
  const weeks = clampAnalyticsWeeks(input.weeks);
  const startMonday = addDaysToDate(mondayOf(today), -(weeks - 1) * 7);
  const f = fileFilter(input.fileId);
  const db = getDb();

  const sessRows = (
    await db.execute({
      sql: `SELECT task_id, date, start_hhmm, duration_sec FROM work_sessions
            WHERE user_id = ? AND ${f.clause} AND date >= ? AND date <= ?`,
      args: [userId, ...f.args, startMonday, today],
    })
  ).rows;

  const taskRows = (
    await db.execute({
      sql: `SELECT id, date, done, estimate_min FROM tasks
            WHERE user_id = ? AND ${f.clause} AND date IS NOT NULL AND date >= ? AND date <= ?`,
      args: [userId, ...f.args, startMonday, today],
    })
  ).rows;

  // Tiempo registrado por tarea, para cruzar contra la estimación.
  const loggedByTask = new Map<string, number>();
  for (const r of sessRows) {
    const id = String(r.task_id);
    loggedByTask.set(id, (loggedByTask.get(id) ?? 0) + Number(r.duration_sec));
  }
  const estimates = taskRows
    .filter((r) => r.estimate_min != null && Number(r.done) === 1)
    .map((r) => ({
      estimateMinutes: Number(r.estimate_min),
      loggedSeconds: loggedByTask.get(String(r.id)) ?? 0,
    }));

  return computeAnalytics(
    sessRows.map((r) => ({
      date: String(r.date),
      start: String(r.start_hhmm),
      durationSec: Number(r.duration_sec),
    })),
    taskRows.map((r) => ({ date: String(r.date), done: Number(r.done) === 1 })),
    { weeks, startMonday, endDate: today },
    estimates
  );
}

// --- Reporte ---

async function getSessionsInRange(input: ReportInput): Promise<SessionRow[]> {
  const userId = currentUserId();
  const { from, to, fileId } = input;
  if (!from || !DATE_RE.test(from)) throw new BadRequestError('invalid_from', 'from debe ser "YYYY-MM-DD"');
  if (!to || !DATE_RE.test(to)) throw new BadRequestError('invalid_to', 'to debe ser "YYYY-MM-DD"');
  if (to < from) throw new BadRequestError('invalid_range', 'to no puede ser antes que from');

  const f = fileFilter(fileId, 'ws.file');
  const rows = (
    await getDb().execute({
      sql: `SELECT ws.date, ws.duration_sec, ws.start_hhmm, ws.end_hhmm,
                   t.id AS task_id, t.name AS task_name, t.estimate_min
            FROM work_sessions ws JOIN tasks t ON t.id = ws.task_id
            WHERE ws.user_id = ? AND ${f.clause} AND ws.date >= ? AND ws.date <= ?
            ORDER BY ws.date, ws.start_hhmm`,
      args: [userId, ...f.args, from, to],
    })
  ).rows;

  const tagsByTask = await tagIdsByTask([...new Set(rows.map((r) => String(r.task_id)))]);

  return rows.map((r) => {
    const date = String(r.date);
    const taskId = String(r.task_id);
    return {
      date,
      day: weekdayNameOf(date) ?? '',
      week: weekLabelOf(mondayOf(date)),
      taskId,
      task: String(r.task_name),
      estimateMinutes: r.estimate_min == null ? null : Number(r.estimate_min),
      tagIds: tagsByTask.get(taskId) ?? [],
      durationSeconds: Number(r.duration_sec),
      start: String(r.start_hhmm),
      end: String(r.end_hhmm),
    };
  });
}

// --- Búsqueda de tareas ---

const SEARCH_LIMIT = 50;

/** Escapa los comodines de LIKE (`%` `_`) y el propio escape (`\`). */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function searchTasks(input: SearchTasksInput): Promise<TaskSearchResult[]> {
  const userId = currentUserId();
  const query = (input.query ?? '').trim();
  if (query.length === 0) return [];

  const f = fileFilter(input.fileId);
  const rows = (
    await getDb().execute({
      sql: `SELECT id, name, date, done, file,
                   EXISTS(SELECT 1 FROM work_sessions ws WHERE ws.task_id = tasks.id) AS has_sessions
            FROM tasks
            WHERE user_id = ? AND ${f.clause} AND name LIKE ? ESCAPE '\\'
            ORDER BY (date IS NULL), date DESC, "order"
            LIMIT ?`,
      args: [userId, ...f.args, `%${escapeLike(query)}%`, SEARCH_LIMIT],
    })
  ).rows;

  return rows.map((r) => {
    const date = r.date == null ? null : String(r.date);
    return {
      id: String(r.id),
      name: String(r.name),
      date,
      done: Number(r.done) === 1,
      file: r.file == null ? null : String(r.file),
      weekLabel: date ? weekLabelOf(mondayOf(date)) : null,
      day: date ? weekdayNameOf(date) : null,
      hasSessions: Number(r.has_sessions) === 1,
    };
  });
}

// --- Backup / restore ---

function toBackupValue(v: unknown): BackupValue {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return String(v);
}

async function exportBackup(): Promise<Backup> {
  const userId = currentUserId();
  const db = getDb();
  const data: Backup['data'] = {};

  for (const t of BACKUP_TABLES) {
    const quoted = t.columns.map((c) => `"${c}"`).join(', ');
    const rows = (
      await db.execute({
        sql: `SELECT ${quoted} FROM "${t.table}" WHERE ${t.scopeWhere} ORDER BY rowid`,
        args: [userId],
      })
    ).rows;
    data[t.table] = rows.map((r) => {
      const o: Record<string, BackupValue> = {};
      for (const c of t.columns) o[c] = toBackupValue(r[c]);
      return o;
    });
  }

  return {
    format: 'pomotion-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  };
}

async function importBackup(input: { backup: unknown }): Promise<ImportResult> {
  const userId = currentUserId();
  const db = getDb();
  const backup = parseBackup(input.backup);

  const countSql = ACCOUNT_NONEMPTY_TABLES.map(
    (t) => `(SELECT COUNT(*) FROM "${t}" WHERE user_id = ?)`
  ).join(' + ');
  const existing = Number(
    (
      await db.execute({
        sql: `SELECT ${countSql} AS n`,
        args: ACCOUNT_NONEMPTY_TABLES.map(() => userId),
      })
    ).rows[0].n
  );
  if (existing > 0) {
    throw new ConflictError(
      'account_not_empty',
      'La cuenta ya tiene datos. El restore solo funciona en una cuenta vacía.'
    );
  }

  const data = remapIds(backup.data, () => crypto.randomUUID());
  const stmts: { sql: string; args: BackupValue[] }[] = [];
  const imported: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    const rows = data[t.table] ?? [];
    imported[t.table] = rows.length;
    stmts.push(
      ...buildInserts(
        t.table,
        t.columns,
        rows,
        t.hasUserId ? { column: 'user_id', value: userId } : undefined
      )
    );
  }
  if (stmts.length > 0) await db.batch(stmts, 'write');

  return { imported };
}

async function listFiles(): Promise<FileEntry[]> {
  const userId = currentUserId();
  const rows = (
    await getDb().execute({
      sql: 'SELECT DISTINCT file FROM tasks WHERE user_id = ? AND file IS NOT NULL ORDER BY file',
      args: [userId],
    })
  ).rows;
  return rows.map((r) => ({ id: String(r.file), label: String(r.file) }));
}

// --- Etiquetas / proyectos ---

function normalizeTagColor(color: string | undefined): string {
  if (color == null) return DEFAULT_TAG_COLOR;
  return TAG_COLORS.has(color) ? color : DEFAULT_TAG_COLOR;
}

function cleanTagName(name: string | undefined): string {
  const trimmed = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!trimmed) throw new BadRequestError('invalid_tag_name', 'El nombre de la etiqueta no puede estar vacío');
  if (trimmed.length > TAG_NAME_MAX) {
    throw new BadRequestError('invalid_tag_name', `La etiqueta no puede pasar de ${TAG_NAME_MAX} caracteres`);
  }
  return trimmed;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

async function listTags(): Promise<Tag[]> {
  const userId = currentUserId();
  const rows = (
    await getDb().execute({
      sql: 'SELECT * FROM tags WHERE user_id = ? ORDER BY name COLLATE NOCASE',
      args: [userId],
    })
  ).rows;
  return rows.map(toTag);
}

async function createTag(input: CreateTagInput): Promise<Tag> {
  const userId = currentUserId();
  const name = cleanTagName(input.name);
  const color = normalizeTagColor(input.color);
  const id = crypto.randomUUID();
  try {
    await getDb().execute({
      sql: 'INSERT INTO tags (id, user_id, name, color) VALUES (?, ?, ?, ?)',
      args: [id, userId, name, color],
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError('tag_exists', `Ya existe una etiqueta "${name}"`);
    throw err;
  }
  return { id, name, color };
}

async function updateTag(input: UpdateTagInput): Promise<Tag> {
  const userId = currentUserId();
  if (!input.id) throw new BadRequestError('invalid_tag_id', 'Falta id');

  const sets: string[] = [];
  const args: InValue[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    args.push(cleanTagName(input.name));
  }
  if (input.color !== undefined) {
    sets.push('color = ?');
    args.push(normalizeTagColor(input.color));
  }
  if (sets.length === 0) throw new BadRequestError('nothing_to_update', 'Nada que actualizar');

  let res;
  try {
    res = await getDb().execute({
      sql: `UPDATE tags SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
      args: [...args, input.id, userId],
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError('tag_exists', 'Ya existe una etiqueta con ese nombre');
    throw err;
  }
  if (res.rowsAffected === 0) throw new NotFoundError('tag_not_found', 'Etiqueta no encontrada');

  const row = (
    await getDb().execute({ sql: 'SELECT * FROM tags WHERE id = ?', args: [input.id] })
  ).rows[0];
  return toTag(row);
}

async function deleteTag(id?: string): Promise<void> {
  const userId = currentUserId();
  if (!id) throw new BadRequestError('invalid_tag_id', 'Falta id');
  await getDb().batch(
    [
      { sql: 'DELETE FROM task_tags WHERE tag_id = ?', args: [id] },
      { sql: 'DELETE FROM tags WHERE id = ? AND user_id = ?', args: [id, userId] },
    ],
    'write'
  );
}

// --- Tareas ---

async function createTask(input: CreateTaskInput): Promise<Task> {
  const userId = currentUserId();
  // date ausente/null → tarea de inbox (sin fecha).
  const date = input.date == null ? null : input.date;
  if (date != null && !DATE_RE.test(date)) {
    throw new BadRequestError('invalid_date', 'date debe ser "YYYY-MM-DD" o null');
  }
  const name = typeof input.text === 'string' ? input.text.trim() : '';
  if (!name) throw new BadRequestError('invalid_text', 'El texto no puede estar vacío');

  const file = input.fileId ?? null;
  const order = await computeOrder(userId, date, file, input.afterId);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await getDb().execute({
    sql: `INSERT INTO tasks (id, user_id, name, date, done, "order", file, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    args: [id, userId, name, date, order, file, now, now],
  });
  return {
    id,
    name,
    date,
    done: false,
    order,
    file,
    priority: null,
    notes: null,
    due: null,
    estimateMinutes: null,
    tagIds: [],
    source: 'manual',
    createdAt: now,
    sessions: [],
  };
}

const NOTES_MAX = 4000;
// Tope defensivo para la estimación: 100 horas. Más que eso es un error de tipeo.
const ESTIMATE_MAX_MIN = 6000;

async function updateTask(input: UpdateTaskInput): Promise<UpdateTaskResult> {
  const userId = currentUserId();
  if (!input.taskId) throw new BadRequestError('invalid_task_id', 'Falta task_id');

  const sets: string[] = [];
  const args: unknown[] = [];
  const result: UpdateTaskResult = {};

  if (input.done !== undefined) {
    if (typeof input.done !== 'boolean') throw new BadRequestError('invalid_done', 'done debe ser booleano');
    sets.push('done = ?');
    args.push(input.done ? 1 : 0);
    result.done = input.done;
  }
  if (input.text !== undefined) {
    const trimmed = typeof input.text === 'string' ? input.text.trim() : '';
    if (!trimmed) throw new BadRequestError('invalid_text', 'El texto no puede estar vacío');
    sets.push('name = ?');
    args.push(trimmed);
    result.text = trimmed;
  }
  if (input.priority !== undefined) {
    const p = input.priority;
    if (p !== null && !PRIORITIES.has(p)) {
      throw new BadRequestError('invalid_priority', 'priority debe ser low/med/high o null');
    }
    sets.push('priority = ?');
    args.push(p);
    result.priority = p;
  }
  if (input.notes !== undefined) {
    const raw = typeof input.notes === 'string' ? input.notes.trim() : '';
    if (raw.length > NOTES_MAX) {
      throw new BadRequestError('invalid_notes', `Las notas no pueden pasar de ${NOTES_MAX} caracteres`);
    }
    const notes = raw.length > 0 ? raw : null;
    sets.push('notes = ?');
    args.push(notes);
    result.notes = notes;
  }
  if (input.due !== undefined) {
    const d = input.due;
    if (d !== null && !DATE_RE.test(d)) {
      throw new BadRequestError('invalid_due', 'due debe ser "YYYY-MM-DD" o null');
    }
    sets.push('due = ?');
    args.push(d);
    result.due = d;
  }
  if (input.estimateMinutes !== undefined) {
    const e = input.estimateMinutes;
    let value: number | null = null;
    if (e !== null) {
      if (typeof e !== 'number' || !Number.isFinite(e) || e <= 0 || e > ESTIMATE_MAX_MIN) {
        throw new BadRequestError(
          'invalid_estimate',
          `estimate_min debe ser un número entre 1 y ${ESTIMATE_MAX_MIN} o null`
        );
      }
      value = Math.round(e);
    }
    sets.push('estimate_min = ?');
    args.push(value);
    result.estimateMinutes = value;
  }

  let nextTagIds: string[] | undefined;
  if (input.tagIds !== undefined) {
    if (!Array.isArray(input.tagIds) || input.tagIds.some((t) => typeof t !== 'string')) {
      throw new BadRequestError('invalid_tag_ids', 'tag_ids debe ser una lista de ids');
    }
    nextTagIds = [...new Set(input.tagIds)];
    if (nextTagIds.length > 0) {
      const placeholders = nextTagIds.map(() => '?').join(',');
      const owned = (
        await getDb().execute({
          sql: `SELECT id FROM tags WHERE user_id = ? AND id IN (${placeholders})`,
          args: [userId, ...nextTagIds],
        })
      ).rows.map((r) => String(r.id));
      if (owned.length !== nextTagIds.length) {
        throw new BadRequestError('unknown_tag', 'Alguna etiqueta no existe');
      }
    }
  }

  if (sets.length === 0 && nextTagIds === undefined) {
    throw new BadRequestError('nothing_to_update', 'Nada que actualizar');
  }

  sets.push('updated_at = ?');
  args.push(new Date().toISOString());

  const res = await getDb().execute({
    sql: `UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    args: [...args, input.taskId, userId] as InValue[],
  });
  if (res.rowsAffected === 0) throw new NotFoundError('task_not_found', 'Tarea no encontrada');

  if (nextTagIds !== undefined) {
    const stmts: { sql: string; args: InValue[] }[] = [
      { sql: 'DELETE FROM task_tags WHERE task_id = ?', args: [input.taskId] },
    ];
    for (const tagId of nextTagIds) {
      stmts.push({
        sql: 'INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)',
        args: [input.taskId, tagId],
      });
    }
    await getDb().batch(stmts, 'write');
    result.tagIds = nextTagIds;
  }
  return result;
}

async function deleteTask(taskId?: string): Promise<void> {
  const userId = currentUserId();
  if (!taskId) throw new BadRequestError('invalid_task_id', 'Falta task_id');
  // El enforcement de FK ON DELETE CASCADE no es fiable por conexión en
  // Turso → borro las filas dependientes explícitamente.
  await getDb().batch(
    [
      { sql: 'DELETE FROM work_sessions WHERE task_id = ? AND user_id = ?', args: [taskId, userId] },
      { sql: 'DELETE FROM task_tags WHERE task_id = ?', args: [taskId] },
      { sql: 'DELETE FROM tasks WHERE id = ? AND user_id = ?', args: [taskId, userId] },
    ],
    'write'
  );
}

async function updateTaskPosition(input: UpdateTaskPositionInput): Promise<{ id: string }> {
  const userId = currentUserId();
  if (!input.taskId) throw new BadRequestError('invalid_task_id', 'Falta task_id');

  const cur = (
    await getDb().execute({
      sql: 'SELECT date, file FROM tasks WHERE id = ? AND user_id = ?',
      args: [input.taskId, userId],
    })
  ).rows[0];
  if (!cur) throw new NotFoundError('task_not_found', 'Tarea no encontrada');

  const file = cur.file == null ? null : String(cur.file);
  const currentDate = cur.date == null ? null : String(cur.date);

  // date: null → inbox; undefined → no cambiar el día; 'YYYY-MM-DD' → ese día.
  let targetDate: string | null;
  if (input.date === null) targetDate = null;
  else if (input.date === undefined) targetDate = currentDate;
  else if (DATE_RE.test(input.date)) targetDate = input.date;
  else targetDate = currentDate;

  // Al inbox no van tareas con tiempo registrado: sus sesiones están atadas
  // a un día real (work_sessions.date NOT NULL). El inbox es para pendientes
  // sin arrancar.
  if (targetDate === null) {
    const count = Number(
      (
        await getDb().execute({
          sql: 'SELECT count(*) AS c FROM work_sessions WHERE task_id = ? AND user_id = ?',
          args: [input.taskId, userId],
        })
      ).rows[0]?.c ?? 0
    );
    if (count > 0) {
      throw new BadRequestError(
        'task_has_sessions',
        'La tarea tiene tiempo registrado; no se puede mandar al inbox.'
      );
    }
  }

  const order = await computeOrder(userId, targetDate, file, input.afterId);
  const now = new Date().toISOString();

  const stmts: { sql: string; args: InValue[] }[] = [
    {
      sql: 'UPDATE tasks SET date = ?, "order" = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      args: [targetDate, order, now, input.taskId, userId],
    },
  ];
  if (targetDate !== currentDate && targetDate !== null) {
    stmts.push({
      sql: 'UPDATE work_sessions SET date = ? WHERE task_id = ? AND user_id = ?',
      args: [targetDate, input.taskId, userId],
    });
  }
  await getDb().batch(stmts, 'write');
  return { id: input.taskId };
}

// --- Acciones en lote ---

const BULK_OPS = new Set(['complete', 'reopen', 'move', 'inbox', 'add_tag', 'delete']);
const BULK_MAX = 200;

async function bulkTasks(input: BulkTasksInput): Promise<BulkResult> {
  const userId = currentUserId();
  const db = getDb();

  if (!input.op || !BULK_OPS.has(input.op)) {
    throw new BadRequestError('invalid_op', 'op debe ser complete/reopen/move/inbox/add_tag/delete');
  }
  const ids = [...new Set((Array.isArray(input.ids) ? input.ids : []).filter((x): x is string => typeof x === 'string'))];
  if (ids.length === 0) throw new BadRequestError('no_tasks', 'No hay tareas seleccionadas');
  if (ids.length > BULK_MAX) throw new BadRequestError('too_many', `Máximo ${BULK_MAX} tareas por lote`);

  // Solo las tareas que son del usuario (ids ajenos/desconocidos se ignoran),
  // en su orden visual — importa para 'move'/'inbox', que reordenan al vuelo.
  const ph = ids.map(() => '?').join(',');
  const owned = (
    await db.execute({
      sql: `SELECT id FROM tasks WHERE user_id = ? AND id IN (${ph}) ORDER BY "order", created_at`,
      args: [userId, ...ids],
    })
  ).rows.map((r) => String(r.id));
  if (owned.length === 0) throw new NotFoundError('task_not_found', 'Ninguna tarea encontrada');

  const now = new Date().toISOString();
  const oph = owned.map(() => '?').join(',');

  if (input.op === 'complete' || input.op === 'reopen') {
    await db.execute({
      sql: `UPDATE tasks SET done = ?, updated_at = ? WHERE user_id = ? AND id IN (${oph})`,
      args: [input.op === 'complete' ? 1 : 0, now, userId, ...owned],
    });
    return { affected: owned.length, skipped: 0 };
  }

  if (input.op === 'delete') {
    await db.batch(
      [
        { sql: `DELETE FROM work_sessions WHERE user_id = ? AND task_id IN (${oph})`, args: [userId, ...owned] },
        { sql: `DELETE FROM task_tags WHERE task_id IN (${oph})`, args: owned },
        { sql: `DELETE FROM tasks WHERE user_id = ? AND id IN (${oph})`, args: [userId, ...owned] },
      ],
      'write'
    );
    return { affected: owned.length, skipped: 0 };
  }

  if (input.op === 'add_tag') {
    if (!input.tagId) throw new BadRequestError('invalid_tag_id', 'Falta tag_id');
    const tag = (
      await db.execute({ sql: 'SELECT id FROM tags WHERE user_id = ? AND id = ?', args: [userId, input.tagId] })
    ).rows[0];
    if (!tag) throw new BadRequestError('unknown_tag', 'La etiqueta no existe');
    await db.batch(
      owned.map((id) => ({
        sql: 'INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)',
        args: [id, input.tagId!],
      })),
      'write'
    );
    return { affected: owned.length, skipped: 0 };
  }

  if (input.op === 'move') {
    if (!input.date || !DATE_RE.test(input.date)) {
      throw new BadRequestError('invalid_date', 'date debe ser "YYYY-MM-DD"');
    }
    // Reusa updateTaskPosition (guardas + orden fraccional). N es chico.
    for (const id of owned) await updateTaskPosition({ taskId: id, date: input.date });
    return { affected: owned.length, skipped: 0 };
  }

  // op === 'inbox': las tareas con tiempo registrado no pueden ir al inbox.
  let skipped = 0;
  for (const id of owned) {
    try {
      await updateTaskPosition({ taskId: id, date: null });
    } catch (err) {
      if (err instanceof BadRequestError && err.code === 'task_has_sessions') skipped += 1;
      else throw err;
    }
  }
  return { affected: owned.length - skipped, skipped };
}

// --- Sesiones ---

async function logSession(input: LogSessionInput): Promise<Session> {
  const userId = currentUserId();
  if (!input.taskId) throw new BadRequestError('invalid_task_id', 'Falta task_id');
  if (
    typeof input.durationSeconds !== 'number' ||
    !Number.isFinite(input.durationSeconds) ||
    input.durationSeconds <= 0
  ) {
    throw new BadRequestError('invalid_duration', 'duration_seconds inválido');
  }

  let startLabel: string;
  let endLabel: string;
  if (input.startTime && input.endTime) {
    startLabel = formatTimeFromIso(input.startTime);
    endLabel = formatTimeFromIso(input.endTime);
  } else if (input.start && input.end) {
    if (!isValidTimeLabel(input.start) || !isValidTimeLabel(input.end)) {
      throw new BadRequestError('invalid_time', 'start/end deben ser "HH:MM"');
    }
    startLabel = input.start;
    endLabel = input.end;
  } else {
    throw new BadRequestError('missing_time_range', 'Faltan start_time/end_time o start/end');
  }

  const task = (
    await getDb().execute({
      sql: 'SELECT date, file FROM tasks WHERE id = ? AND user_id = ?',
      args: [input.taskId, userId],
    })
  ).rows[0];
  if (!task) throw new NotFoundError('task_not_found', 'Tarea no encontrada');
  if (task.date == null) {
    throw new BadRequestError('task_has_no_date', 'Programá la tarea antes de registrar tiempo.');
  }

  const rounded = roundDurationSeconds(input.durationSeconds);
  const id = crypto.randomUUID();
  await getDb().execute({
    sql: `INSERT INTO work_sessions
            (id, user_id, task_id, duration_sec, start_hhmm, end_hhmm, date, file, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      userId,
      input.taskId,
      rounded,
      startLabel,
      endLabel,
      String(task.date),
      task.file == null ? null : String(task.file),
      new Date().toISOString(),
    ],
  });
  return { id, taskId: input.taskId, durationSeconds: rounded, start: startLabel, end: endLabel };
}

async function updateSession(input: UpdateSessionInput): Promise<Session> {
  const userId = currentUserId();
  if (!input.sessionId) throw new BadRequestError('invalid_session_id', 'Falta session_id');
  if (
    typeof input.durationSeconds !== 'number' ||
    !Number.isFinite(input.durationSeconds) ||
    input.durationSeconds <= 0
  ) {
    throw new BadRequestError('invalid_duration', 'duration_seconds inválido');
  }
  if (!input.start || !input.end || !isValidTimeLabel(input.start) || !isValidTimeLabel(input.end)) {
    throw new BadRequestError('invalid_time', 'start/end deben ser "HH:MM"');
  }

  const rounded = roundDurationSeconds(input.durationSeconds);
  const res = await getDb().execute({
    sql: 'UPDATE work_sessions SET duration_sec = ?, start_hhmm = ?, end_hhmm = ? WHERE id = ? AND user_id = ?',
    args: [rounded, input.start, input.end, input.sessionId, userId],
  });
  if (res.rowsAffected === 0) throw new NotFoundError('session_not_found', 'Sesión no encontrada');

  const row = (
    await getDb().execute({ sql: 'SELECT task_id FROM work_sessions WHERE id = ?', args: [input.sessionId] })
  ).rows[0];
  return {
    id: input.sessionId,
    taskId: String(row.task_id),
    durationSeconds: rounded,
    start: input.start,
    end: input.end,
  };
}

async function deleteSession(sessionId?: string): Promise<void> {
  const userId = currentUserId();
  if (!sessionId) throw new BadRequestError('invalid_session_id', 'Falta session_id');
  await getDb().execute({
    sql: 'DELETE FROM work_sessions WHERE id = ? AND user_id = ?',
    args: [sessionId, userId],
  });
}

// --- Recurrentes ---

async function listRecurringRules(): Promise<RecurringRule[]> {
  const userId = currentUserId();
  const rows = (
    await getDb().execute({
      sql: 'SELECT * FROM recurring_rules WHERE user_id = ? ORDER BY created_at',
      args: [userId],
    })
  ).rows;
  return rows.map(toRule);
}

async function createRecurringRule(input: CreateRecurringRuleInput): Promise<RecurringRule> {
  const userId = currentUserId();
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new BadRequestError('invalid_name', 'El nombre no puede estar vacío');
  const weekdays = input.weekdays && WEEKDAYS_RE.test(input.weekdays) ? input.weekdays : '1,2,3,4,5';
  const file = input.fileId ?? null;
  const id = crypto.randomUUID();
  await getDb().execute({
    sql: `INSERT INTO recurring_rules (id, user_id, name, file, weekdays, active, created_at)
          VALUES (?, ?, ?, ?, ?, 1, ?)`,
    args: [id, userId, name, file, weekdays, new Date().toISOString()],
  });
  return { id, name, file, weekdays, active: true };
}

async function updateRecurringRule(input: UpdateRecurringRuleInput): Promise<RecurringRule> {
  const userId = currentUserId();
  if (!input.id) throw new BadRequestError('invalid_id', 'Falta id');

  const sets: string[] = [];
  const args: unknown[] = [];
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) throw new BadRequestError('invalid_name', 'El nombre no puede estar vacío');
    sets.push('name = ?');
    args.push(n);
  }
  if (input.weekdays !== undefined) {
    if (!WEEKDAYS_RE.test(input.weekdays)) throw new BadRequestError('invalid_weekdays', 'weekdays inválido');
    sets.push('weekdays = ?');
    args.push(input.weekdays);
  }
  if (input.active !== undefined) {
    sets.push('active = ?');
    args.push(input.active ? 1 : 0);
  }
  if (sets.length === 0) throw new BadRequestError('nothing_to_update', 'Nada que actualizar');

  const res = await getDb().execute({
    sql: `UPDATE recurring_rules SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    args: [...args, input.id, userId] as InValue[],
  });
  if (res.rowsAffected === 0) throw new NotFoundError('rule_not_found', 'Regla no encontrada');

  const row = (
    await getDb().execute({ sql: 'SELECT * FROM recurring_rules WHERE id = ?', args: [input.id] })
  ).rows[0];
  return toRule(row);
}

async function deleteRecurringRule(id?: string): Promise<void> {
  const userId = currentUserId();
  if (!id) throw new BadRequestError('invalid_id', 'Falta id');
  await getDb().execute({
    sql: 'DELETE FROM recurring_rules WHERE id = ? AND user_id = ?',
    args: [id, userId],
  });
}

/** Semana + contexto donde ya se materializaron las recurrentes. */
const runKey = (file: string | null): string => file ?? '';

/** Registra (o refresca) que las recurrentes ya corrieron para esta
 *  semana/contexto — el "Aplicar" manual también cuenta. */
async function markRecurringRun(userId: string, weekStart: string, file: string | null): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO recurring_runs (user_id, week_start, file_key, applied_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (user_id, week_start, file_key)
            DO UPDATE SET applied_at = excluded.applied_at`,
    args: [userId, weekStart, runKey(file), new Date().toISOString()],
  });
}

/** Materializa las recurrentes en `weekStart` una única vez: reclama la
 *  semana con un INSERT best-effort y solo aplica si nadie la reclamó antes
 *  (otra request concurrente, o el "Aplicar" manual). */
async function autoApplyRecurring(
  userId: string,
  weekStart: string,
  file: string | null
): Promise<void> {
  const claim = await getDb().execute({
    sql: `INSERT OR IGNORE INTO recurring_runs (user_id, week_start, file_key, applied_at)
          VALUES (?, ?, ?, ?)`,
    args: [userId, weekStart, runKey(file), new Date().toISOString()],
  });
  if (claim.rowsAffected === 0) return; // ya se aplicó esta semana/contexto
  await applyRulesToWeek(userId, weekStart, file);
}

async function applyRecurringToWeek(input: ApplyRecurringInput): Promise<{ added: number }> {
  const userId = currentUserId();
  const weekStart = resolveWeekStart(input.week, TIMEZONE);
  const file = input.fileId ?? null;
  const result = await applyRulesToWeek(userId, weekStart, file);
  await markRecurringRun(userId, weekStart, file);
  return result;
}

/** Agrega a la semana las tareas de las reglas activas que apliquen a cada
 *  día, saltando las que ya existan (dedup por nombre normalizado).
 *  Idempotente. */
async function applyRulesToWeek(
  userId: string,
  weekStart: string,
  file: string | null
): Promise<{ added: number }> {
  const dates = weekDates(weekStart);
  const f = fileFilter(file ?? undefined);
  const db = getDb();

  const rules = (
    await db.execute({
      sql: 'SELECT * FROM recurring_rules WHERE user_id = ? AND active = 1',
      args: [userId],
    })
  ).rows
    .map(toRule)
    .filter((r) => r.file == null || r.file === file);
  if (rules.length === 0) return { added: 0 };

  const existing = (
    await db.execute({
      sql: `SELECT date, name FROM tasks WHERE user_id = ? AND ${f.clause} AND date >= ? AND date <= ?`,
      args: [userId, ...f.args, dates[0], dates[4]],
    })
  ).rows;
  const namesByDate = new Map<string, Set<string>>();
  for (const r of existing) {
    const d = String(r.date);
    (namesByDate.get(d) ?? namesByDate.set(d, new Set()).get(d)!).add(normalize(String(r.name)));
  }

  const maxOrderByDate = new Map<string, number>();
  for (const r of (
    await db.execute({
      sql: `SELECT date, max("order") AS o FROM tasks WHERE user_id = ? AND ${f.clause} AND date >= ? AND date <= ? GROUP BY date`,
      args: [userId, ...f.args, dates[0], dates[4]],
    })
  ).rows) {
    maxOrderByDate.set(String(r.date), Number(r.o));
  }

  const now = new Date().toISOString();
  const inserts: { sql: string; args: InValue[] }[] = [];
  for (let i = 0; i < 5; i++) {
    const date = dates[i];
    const weekday = String(i + 1);
    const have = namesByDate.get(date) ?? new Set<string>();
    let order = maxOrderByDate.get(date) ?? 0;
    for (const rule of rules) {
      if (!rule.weekdays.split(',').includes(weekday)) continue;
      const key = normalize(rule.name);
      if (have.has(key)) continue;
      have.add(key);
      order += 1;
      inserts.push({
        sql: `INSERT INTO tasks (id, user_id, name, date, done, "order", file, recurring_rule_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        args: [crypto.randomUUID(), userId, rule.name, date, order, file, rule.id, now, now],
      });
    }
  }

  if (inserts.length > 0) await db.batch(inserts, 'write');
  return { added: inserts.length };
}

// --- Plantillas de día ---

const TEMPLATE_NAME_MAX = 60;
const TEMPLATE_MAX_ITEMS = 40;

function toDayTemplate(r: Row, items: DayTemplateItem[]): DayTemplate {
  return {
    id: String(r.id),
    name: String(r.name),
    file: r.file == null ? null : String(r.file),
    items,
  };
}

function toTemplateItem(r: Row): DayTemplateItem {
  const p = r.priority == null ? null : String(r.priority);
  return {
    name: String(r.name),
    priority: p && PRIORITIES.has(p) ? (p as TaskPriority) : null,
    estimateMinutes: r.estimate_min == null ? null : Number(r.estimate_min),
  };
}

async function listDayTemplatesFor(userId: string): Promise<DayTemplate[]> {
  const db = getDb();
  const tplRows = (
    await db.execute({
      sql: 'SELECT * FROM day_templates WHERE user_id = ? ORDER BY name COLLATE NOCASE',
      args: [userId],
    })
  ).rows;
  if (tplRows.length === 0) return [];

  const itemRows = (
    await db.execute({
      sql: `SELECT ti.* FROM day_template_items ti
            JOIN day_templates t ON t.id = ti.template_id
            WHERE t.user_id = ?
            ORDER BY ti."order", ti.rowid`,
      args: [userId],
    })
  ).rows;
  const byTemplate = new Map<string, DayTemplateItem[]>();
  for (const r of itemRows) {
    const tid = String(r.template_id);
    (byTemplate.get(tid) ?? byTemplate.set(tid, []).get(tid)!).push(toTemplateItem(r));
  }
  return tplRows.map((r) => toDayTemplate(r, byTemplate.get(String(r.id)) ?? []));
}

function cleanItems(items: DayTemplateItemInput[] | undefined): DayTemplateItem[] {
  if (!Array.isArray(items)) return [];
  const out: DayTemplateItem[] = [];
  for (const raw of items) {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    if (!name) continue;
    const p = raw.priority ?? null;
    if (p !== null && !PRIORITIES.has(p)) {
      throw new BadRequestError('invalid_priority', 'priority de un ítem inválida');
    }
    let est: number | null = null;
    if (raw.estimateMinutes != null) {
      const e = raw.estimateMinutes;
      if (typeof e !== 'number' || !Number.isFinite(e) || e <= 0 || e > ESTIMATE_MAX_MIN) {
        throw new BadRequestError('invalid_estimate', 'estimate_min de un ítem inválido');
      }
      est = Math.round(e);
    }
    out.push({ name, priority: p as TaskPriority | null, estimateMinutes: est });
    if (out.length >= TEMPLATE_MAX_ITEMS) break;
  }
  return out;
}

function cleanTemplateName(name: string | undefined): string {
  const trimmed = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!trimmed) throw new BadRequestError('invalid_template_name', 'La plantilla necesita un nombre');
  if (trimmed.length > TEMPLATE_NAME_MAX) {
    throw new BadRequestError('invalid_template_name', `El nombre no puede pasar de ${TEMPLATE_NAME_MAX} caracteres`);
  }
  return trimmed;
}

async function itemsFromDay(
  userId: string,
  date: string,
  file: string | null
): Promise<DayTemplateItem[]> {
  const f = fileFilter(file ?? undefined);
  const rows = (
    await getDb().execute({
      sql: `SELECT name, priority, estimate_min FROM tasks
            WHERE user_id = ? AND ${f.clause} AND date = ?
            ORDER BY "order", created_at`,
      args: [userId, ...f.args, date],
    })
  ).rows;
  return rows.slice(0, TEMPLATE_MAX_ITEMS).map(toTemplateItem);
}

async function writeItems(templateId: string, items: DayTemplateItem[]): Promise<void> {
  if (items.length === 0) return;
  await getDb().batch(
    items.map((it, i) => ({
      sql: `INSERT INTO day_template_items (id, template_id, name, "order", priority, estimate_min)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [crypto.randomUUID(), templateId, it.name, i, it.priority, it.estimateMinutes],
    })),
    'write'
  );
}

async function createDayTemplate(input: CreateDayTemplateInput): Promise<DayTemplate> {
  const userId = currentUserId();
  const name = cleanTemplateName(input.name);
  const file = input.fileId ?? null;

  let items: DayTemplateItem[];
  if (input.fromDate) {
    if (!DATE_RE.test(input.fromDate)) {
      throw new BadRequestError('invalid_date', 'from_date debe ser "YYYY-MM-DD"');
    }
    items = await itemsFromDay(userId, input.fromDate, file);
  } else {
    items = cleanItems(input.items);
  }

  const id = crypto.randomUUID();
  await getDb().execute({
    sql: 'INSERT INTO day_templates (id, user_id, name, file, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [id, userId, name, file, new Date().toISOString()],
  });
  await writeItems(id, items);
  return { id, name, file, items };
}

async function updateDayTemplate(input: UpdateDayTemplateInput): Promise<DayTemplate> {
  const userId = currentUserId();
  if (!input.id) throw new BadRequestError('invalid_id', 'Falta id');

  const cur = (
    await getDb().execute({
      sql: 'SELECT * FROM day_templates WHERE id = ? AND user_id = ?',
      args: [input.id, userId],
    })
  ).rows[0];
  if (!cur) throw new NotFoundError('template_not_found', 'Plantilla no encontrada');

  if (input.name !== undefined) {
    await getDb().execute({
      sql: 'UPDATE day_templates SET name = ? WHERE id = ? AND user_id = ?',
      args: [cleanTemplateName(input.name), input.id, userId],
    });
  }
  if (input.items !== undefined) {
    const items = cleanItems(input.items);
    await getDb().execute({
      sql: 'DELETE FROM day_template_items WHERE template_id = ?',
      args: [input.id],
    });
    await writeItems(input.id, items);
  }

  const [tpl] = await listDayTemplatesFor(userId).then((all) => all.filter((t) => t.id === input.id));
  return tpl;
}

async function deleteDayTemplate(id?: string): Promise<void> {
  const userId = currentUserId();
  if (!id) throw new BadRequestError('invalid_id', 'Falta id');
  await getDb().batch(
    [
      { sql: 'DELETE FROM day_template_items WHERE template_id = ?', args: [id] },
      { sql: 'DELETE FROM day_templates WHERE id = ? AND user_id = ?', args: [id, userId] },
    ],
    'write'
  );
}

async function applyDayTemplate(input: ApplyDayTemplateInput): Promise<{ added: number }> {
  const userId = currentUserId();
  if (!input.id) throw new BadRequestError('invalid_id', 'Falta id');
  if (!input.date || !DATE_RE.test(input.date)) {
    throw new BadRequestError('invalid_date', 'date debe ser "YYYY-MM-DD"');
  }
  const date = input.date;
  const file = input.fileId ?? null;
  const f = fileFilter(file ?? undefined);
  const db = getDb();

  const tplRow = (
    await db.execute({
      sql: 'SELECT id FROM day_templates WHERE id = ? AND user_id = ?',
      args: [input.id, userId],
    })
  ).rows[0];
  if (!tplRow) throw new NotFoundError('template_not_found', 'Plantilla no encontrada');

  const items = (
    await db.execute({
      sql: 'SELECT * FROM day_template_items WHERE template_id = ? ORDER BY "order", rowid',
      args: [input.id],
    })
  ).rows.map(toTemplateItem);
  if (items.length === 0) return { added: 0 };

  const existing = new Set(
    (
      await db.execute({
        sql: `SELECT name FROM tasks WHERE user_id = ? AND ${f.clause} AND date = ?`,
        args: [userId, ...f.args, date],
      })
    ).rows.map((r) => normalize(String(r.name)))
  );
  let order = Number(
    (
      await db.execute({
        sql: `SELECT max("order") AS o FROM tasks WHERE user_id = ? AND ${f.clause} AND date = ?`,
        args: [userId, ...f.args, date],
      })
    ).rows[0]?.o ?? 0
  );

  const now = new Date().toISOString();
  const inserts: { sql: string; args: InValue[] }[] = [];
  for (const it of items) {
    const key = normalize(it.name);
    if (existing.has(key)) continue;
    existing.add(key);
    order += 1;
    inserts.push({
      sql: `INSERT INTO tasks (id, user_id, name, date, done, "order", file, priority, estimate_min, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        userId,
        it.name,
        date,
        order,
        file,
        it.priority,
        it.estimateMinutes,
        now,
        now,
      ],
    });
  }
  if (inserts.length > 0) await db.batch(inserts, 'write');
  return { added: inserts.length };
}

// --- Metas ---

const GOAL_MAX_MINUTES = 60_000; // ~1000 h/mes: tope defensivo

function toGoal(r: Row): Goal {
  return {
    id: String(r.id),
    tagId: r.tag_id == null ? null : String(r.tag_id),
    file: r.file == null ? null : String(r.file),
    targetMinutes: Number(r.target_minutes),
  };
}

function cleanTarget(minutes: number | undefined): number {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0 || minutes > GOAL_MAX_MINUTES) {
    throw new BadRequestError('invalid_target', `target_minutes debe ser entre 1 y ${GOAL_MAX_MINUTES}`);
  }
  return Math.round(minutes);
}

async function assertOwnsTag(userId: string, tagId: string): Promise<void> {
  const row = (
    await getDb().execute({ sql: 'SELECT 1 FROM tags WHERE id = ? AND user_id = ?', args: [tagId, userId] })
  ).rows[0];
  if (!row) throw new BadRequestError('unknown_tag', 'La etiqueta no existe');
}

async function listGoals(): Promise<GoalProgress[]> {
  const userId = currentUserId();
  const db = getDb();

  const goals = (
    await db.execute({
      sql: 'SELECT * FROM goals WHERE user_id = ? ORDER BY created_at',
      args: [userId],
    })
  ).rows.map(toGoal);
  if (goals.length === 0) return [];

  const today = todayDateStringInTz(TIMEZONE);
  const month = today.slice(0, 7);
  const { first, last } = monthRange(month);
  const dayOfMonth = Number(today.slice(8, 10));
  const daysInMonth = Number(last.slice(8, 10));

  const tagName = new Map(
    (
      await db.execute({ sql: 'SELECT id, name FROM tags WHERE user_id = ?', args: [userId] })
    ).rows.map((r) => [String(r.id), String(r.name)] as const)
  );

  const sessRows = (
    await db.execute({
      sql: `SELECT duration_sec, file, task_id FROM work_sessions
            WHERE user_id = ? AND date >= ? AND date <= ?`,
      args: [userId, first, last],
    })
  ).rows;
  const tagsByTask = await tagIdsByTask([...new Set(sessRows.map((r) => String(r.task_id)))]);

  return goals.map((goal) => {
    let loggedSeconds = 0;
    for (const s of sessRows) {
      const sFile = s.file == null ? null : String(s.file);
      if (goal.file != null && sFile !== goal.file) continue;
      if (goal.tagId != null && !(tagsByTask.get(String(s.task_id)) ?? []).includes(goal.tagId)) continue;
      loggedSeconds += Number(s.duration_sec);
    }
    return {
      ...goal,
      tagName: goal.tagId == null ? null : (tagName.get(goal.tagId) ?? '(borrada)'),
      month,
      loggedSeconds,
      dayOfMonth,
      daysInMonth,
    };
  });
}

async function createGoal(input: CreateGoalInput): Promise<Goal> {
  const userId = currentUserId();
  const targetMinutes = cleanTarget(input.targetMinutes);
  const tagId = input.tagId ?? null;
  if (tagId != null) await assertOwnsTag(userId, tagId);
  const file = input.fileId ?? null;
  const id = crypto.randomUUID();
  await getDb().execute({
    sql: `INSERT INTO goals (id, user_id, tag_id, file, target_minutes, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, userId, tagId, file, targetMinutes, new Date().toISOString()],
  });
  return { id, tagId, file, targetMinutes };
}

async function updateGoal(input: UpdateGoalInput): Promise<Goal> {
  const userId = currentUserId();
  if (!input.id) throw new BadRequestError('invalid_id', 'Falta id');

  const sets: string[] = [];
  const args: InValue[] = [];
  if (input.targetMinutes !== undefined) {
    sets.push('target_minutes = ?');
    args.push(cleanTarget(input.targetMinutes));
  }
  if (input.tagId !== undefined) {
    if (input.tagId != null) await assertOwnsTag(userId, input.tagId);
    sets.push('tag_id = ?');
    args.push(input.tagId);
  }
  if (sets.length === 0) throw new BadRequestError('nothing_to_update', 'Nada que actualizar');

  const res = await getDb().execute({
    sql: `UPDATE goals SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    args: [...args, input.id, userId],
  });
  if (res.rowsAffected === 0) throw new NotFoundError('goal_not_found', 'Meta no encontrada');

  const row = (await getDb().execute({ sql: 'SELECT * FROM goals WHERE id = ?', args: [input.id] })).rows[0];
  return toGoal(row);
}

async function deleteGoal(id?: string): Promise<void> {
  const userId = currentUserId();
  if (!id) throw new BadRequestError('invalid_id', 'Falta id');
  await getDb().execute({ sql: 'DELETE FROM goals WHERE id = ? AND user_id = ?', args: [id, userId] });
}

// --- Calendarios iCal ---

const FEED_NAME_MAX = 80;
const FEED_URL_MAX = 2000;

function toCalendarFeed(r: Row): CalendarFeed {
  return {
    id: String(r.id),
    name: String(r.name),
    url: String(r.url),
    file: r.file == null ? null : String(r.file),
    enabled: Number(r.enabled) === 1,
    lastSyncedAt: r.last_synced_at == null ? null : String(r.last_synced_at),
    lastError: r.last_error == null ? null : String(r.last_error),
  };
}

function cleanFeedUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (!value || value.length > FEED_URL_MAX) {
    throw new BadRequestError('invalid_url', 'La URL del calendario no es válida');
  }
  let parsed: URL;
  try {
    parsed = new URL(value.replace(/^webcal:\/\//i, 'https://'));
  } catch {
    throw new BadRequestError('invalid_url', 'La URL del calendario no es válida');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BadRequestError('invalid_url', 'La URL debe ser http(s) o webcal');
  }
  return parsed.toString();
}

function cleanFeedName(raw: string | undefined, fallback: string): string {
  const value = (raw ?? '').trim().slice(0, FEED_NAME_MAX);
  return value || fallback;
}

async function currentUserEmail(userId: string): Promise<string | null> {
  const row = (
    await getDb().execute({ sql: 'SELECT email FROM users WHERE id = ?', args: [userId] })
  ).rows[0];
  return row?.email == null ? null : String(row.email);
}

async function listCalendarFeeds(): Promise<CalendarFeed[]> {
  const userId = currentUserId();
  const rows = (
    await getDb().execute({
      sql: 'SELECT * FROM calendar_feeds WHERE user_id = ? ORDER BY created_at',
      args: [userId],
    })
  ).rows;
  return rows.map(toCalendarFeed);
}

async function createCalendarFeed(input: CreateCalendarFeedInput): Promise<CalendarFeed> {
  const userId = currentUserId();
  const url = cleanFeedUrl(input.url);
  const file = input.fileId ?? null;
  const name = cleanFeedName(input.name, 'Calendario');
  const id = crypto.randomUUID();
  await getDb().execute({
    sql: `INSERT INTO calendar_feeds (id, user_id, name, url, file, enabled, created_at)
          VALUES (?, ?, ?, ?, ?, 1, ?)`,
    args: [id, userId, name, url, file, new Date().toISOString()],
  });
  return { id, name, url, file, enabled: true, lastSyncedAt: null, lastError: null };
}

async function updateCalendarFeed(input: UpdateCalendarFeedInput): Promise<CalendarFeed> {
  const userId = currentUserId();
  if (!input.id) throw new BadRequestError('invalid_id', 'Falta id');

  const sets: string[] = [];
  const args: InValue[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    args.push(cleanFeedName(input.name, 'Calendario'));
  }
  if (input.fileId !== undefined) {
    sets.push('file = ?');
    args.push(input.fileId ?? null);
  }
  if (input.enabled !== undefined) {
    sets.push('enabled = ?');
    args.push(input.enabled ? 1 : 0);
  }
  if (sets.length === 0) throw new BadRequestError('nothing_to_update', 'Nada que actualizar');

  const res = await getDb().execute({
    sql: `UPDATE calendar_feeds SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    args: [...args, input.id, userId],
  });
  if (res.rowsAffected === 0) throw new NotFoundError('feed_not_found', 'Calendario no encontrado');

  const row = (
    await getDb().execute({ sql: 'SELECT * FROM calendar_feeds WHERE id = ?', args: [input.id] })
  ).rows[0];
  return toCalendarFeed(row);
}

async function deleteCalendarFeed(id?: string): Promise<void> {
  const userId = currentUserId();
  if (!id) throw new BadRequestError('invalid_id', 'Falta id');
  const db = getDb();

  // Tareas del feed sin historial (sin sesiones) → se borran; el resto queda
  // huérfano (source sigue 'calendar', pero feed_id a NULL).
  const rows = (
    await db.execute({
      sql: `SELECT t.id,
                   EXISTS (SELECT 1 FROM work_sessions ws WHERE ws.task_id = t.id) AS has_sessions
            FROM tasks t WHERE t.user_id = ? AND t.feed_id = ?`,
      args: [userId, id],
    })
  ).rows;
  const removable = rows.filter((r) => Number(r.has_sessions) === 0).map((r) => String(r.id));
  const keep = rows.filter((r) => Number(r.has_sessions) === 1).map((r) => String(r.id));

  const batch: { sql: string; args: InValue[] }[] = [];
  for (const chunk of chunkIds(removable)) {
    const ph = chunk.map(() => '?').join(',');
    batch.push({ sql: `DELETE FROM task_tags WHERE task_id IN (${ph})`, args: [...chunk] });
    batch.push({
      sql: `DELETE FROM tasks WHERE user_id = ? AND id IN (${ph})`,
      args: [userId, ...chunk],
    });
  }
  for (const chunk of chunkIds(keep)) {
    const ph = chunk.map(() => '?').join(',');
    batch.push({
      sql: `UPDATE tasks SET feed_id = NULL, updated_at = ? WHERE user_id = ? AND id IN (${ph})`,
      args: [new Date().toISOString(), userId, ...chunk],
    });
  }
  batch.push({ sql: 'DELETE FROM calendar_feeds WHERE id = ? AND user_id = ?', args: [id, userId] });
  await db.batch(batch, 'write');
}

function chunkIds(ids: string[], size = 50): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

async function syncCalendarFeeds(input: {
  feedId?: string;
  force?: boolean;
}): Promise<SyncCalendarResult> {
  const userId = currentUserId();
  const db = getDb();
  const result: SyncCalendarResult = {
    syncedFeeds: 0,
    added: 0,
    updated: 0,
    removed: 0,
    changed: false,
  };

  const feeds = (
    await db.execute({
      sql: input.feedId
        ? 'SELECT * FROM calendar_feeds WHERE user_id = ? AND id = ?'
        : 'SELECT * FROM calendar_feeds WHERE user_id = ? AND enabled = 1',
      args: input.feedId ? [userId, input.feedId] : [userId],
    })
  ).rows.map(toCalendarFeed);
  if (feeds.length === 0) return result;

  // Pedir un feed puntual (feedId) siempre ignora el debounce.
  const force = input.force === true || typeof input.feedId === 'string';
  const viewerEmail = await currentUserEmail(userId);
  const now = new Date();
  const { start: winStart, end: winEnd } = syncWindow(now);
  const winStartIso = isoDateUtc(winStart);
  const winEndIso = isoDateUtc(winEnd);

  for (const feed of feeds) {
    if (feed.enabled === false && !input.feedId) continue;
    const fresh =
      !force &&
      feed.lastSyncedAt != null &&
      now.getTime() - new Date(feed.lastSyncedAt).getTime() < SYNC_DEBOUNCE_MS;
    if (fresh) continue;

    result.syncedFeeds++;
    try {
      const fetched = await fetchIcalText(feed.url);
      if (!fetched.ok) throw new Error(fetched.error);

      const events = parseIcalEvents(fetched.text, {
        windowStart: winStart,
        windowEnd: winEnd,
        viewerEmail,
      });
      const desired = desiredTasksFromEvents(events, TIMEZONE);

      const existing: FeedTaskRow[] = (
        await db.execute({
          sql: `SELECT t.id, t.external_uid, t.name, t.date, t.external_date, t.notes, t.estimate_min,
                       t.done,
                       EXISTS (SELECT 1 FROM work_sessions ws WHERE ws.task_id = t.id) AS has_sessions
                FROM tasks t
                WHERE t.user_id = ? AND t.feed_id = ?
                  AND t.external_date >= ? AND t.external_date <= ?`,
          args: [userId, feed.id, winStartIso, winEndIso],
        })
      ).rows.map((r) => ({
        id: String(r.id),
        externalUid: String(r.external_uid),
        name: String(r.name),
        date: r.date == null ? null : String(r.date),
        externalDate: r.external_date == null ? null : String(r.external_date),
        notes: r.notes == null ? null : String(r.notes),
        estimateMin: r.estimate_min == null ? null : Number(r.estimate_min),
        done: Number(r.done) === 1,
        hasSessions: Number(r.has_sessions) === 1,
      }));

      const plan = planSync(desired, existing);

      // Orden: al final de cada día, en el bucket del feed.
      const f = fileFilter(feed.file ?? undefined);
      const maxOrderByDate = new Map<string, number>();
      for (const r of (
        await db.execute({
          sql: `SELECT date, max("order") AS o FROM tasks
                WHERE user_id = ? AND ${f.clause} AND date >= ? AND date <= ? GROUP BY date`,
          args: [userId, ...f.args, winStartIso, winEndIso],
        })
      ).rows) {
        maxOrderByDate.set(String(r.date), Number(r.o));
      }

      const iso = now.toISOString();
      const writes: { sql: string; args: InValue[] }[] = [];

      for (const d of plan.create) {
        const order = (maxOrderByDate.get(d.date) ?? 0) + 1;
        maxOrderByDate.set(d.date, order);
        writes.push({
          sql: `INSERT INTO tasks
                  (id, user_id, name, date, done, "order", file, source, feed_id, external_uid,
                   external_date, estimate_min, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, ?, ?, 'calendar', ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            crypto.randomUUID(),
            userId,
            d.name,
            d.date,
            order,
            feed.file,
            feed.id,
            d.externalUid,
            d.date,
            d.estimateMin > 0 ? d.estimateMin : null,
            d.notes,
            iso,
            iso,
          ],
        });
      }
      for (const u of plan.update) {
        writes.push({
          sql: `UPDATE tasks SET name = ?, date = ?, external_date = ?, estimate_min = ?, notes = ?,
                     updated_at = ?
                WHERE id = ? AND user_id = ?`,
          args: [
            u.name,
            u.date,
            u.date,
            u.estimateMin > 0 ? u.estimateMin : null,
            u.notes,
            iso,
            u.id,
            userId,
          ],
        });
      }
      for (const chunk of chunkIds(plan.remove)) {
        const ph = chunk.map(() => '?').join(',');
        writes.push({ sql: `DELETE FROM task_tags WHERE task_id IN (${ph})`, args: [...chunk] });
        writes.push({
          sql: `DELETE FROM tasks WHERE user_id = ? AND id IN (${ph})`,
          args: [userId, ...chunk],
        });
      }
      for (const chunk of chunkIds(plan.orphan)) {
        const ph = chunk.map(() => '?').join(',');
        writes.push({
          sql: `UPDATE tasks SET feed_id = NULL, updated_at = ? WHERE user_id = ? AND id IN (${ph})`,
          args: [iso, userId, ...chunk],
        });
      }

      if (writes.length > 0) await db.batch(writes, 'write');

      result.added += plan.create.length;
      result.updated += plan.update.length;
      result.removed += plan.remove.length + plan.orphan.length;
      if (plan.create.length || plan.update.length || plan.remove.length || plan.orphan.length) {
        result.changed = true;
      }

      await db.execute({
        sql: 'UPDATE calendar_feeds SET last_synced_at = ?, last_error = NULL WHERE id = ? AND user_id = ?',
        args: [iso, feed.id, userId],
      });
    } catch (err) {
      const message = (err instanceof Error ? err.message : 'Error al sincronizar').slice(0, 300);
      await db.execute({
        sql: 'UPDATE calendar_feeds SET last_synced_at = ?, last_error = ? WHERE id = ? AND user_id = ?',
        args: [new Date().toISOString(), message, feed.id, userId],
      });
    }
  }

  return result;
}

export const sqliteStore: TaskStore = {
  getWeekView,
  getMonthSummary,
  getFocusHeatmap,
  getAnalytics,
  getSessionsInRange,
  searchTasks,
  exportBackup,
  importBackup,
  listFiles,
  listTags,
  createTag,
  updateTag,
  deleteTag,
  createTask,
  updateTask,
  deleteTask,
  updateTaskPosition,
  bulkTasks,
  carryOverToToday,
  logSession,
  updateSession,
  deleteSession,
  listRecurringRules,
  createRecurringRule,
  updateRecurringRule,
  deleteRecurringRule,
  applyRecurringToWeek,
  createDayTemplate,
  updateDayTemplate,
  deleteDayTemplate,
  applyDayTemplate,
  listGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  listCalendarFeeds,
  createCalendarFeed,
  updateCalendarFeed,
  deleteCalendarFeed,
  syncCalendarFeeds,
};
