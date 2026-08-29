/**
 * Implementación de `TaskStore` (ver taskStore.ts) contra Turso / libSQL.
 * Toda query se scopea a `currentUserId()` (ver requestContext.ts). Sin
 * transacciones distribuidas: los pocos casos multi-statement usan
 * `db.batch(..., 'write')`.
 */
import crypto from 'node:crypto';
import type { InValue, Row } from '@libsql/client';
import { BadRequestError, NotFoundError } from './errors.js';
import { getDb } from './db.js';
import {
  addDaysToDate,
  addMonths,
  isValidMonth,
  monthRange,
  normalize,
  todayDateStringInTz,
} from './parse.js';
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
  ApplyRecurringInput,
  CreateRecurringRuleInput,
  CreateTaskInput,
  FileEntry,
  FocusHeatmap,
  FocusHeatmapDay,
  GetFocusHeatmapInput,
  GetMonthSummaryInput,
  GetWeekViewInput,
  LogSessionInput,
  MonthDaySummary,
  MonthSummary,
  RecurringRule,
  ReportInput,
  Session,
  SessionRow,
  Task,
  TaskPriority,
  TaskStore,
  UpdateRecurringRuleInput,
  UpdateSessionInput,
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

function toTask(r: Row, sessions: Session[]): Task {
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
    sessions,
  };
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

  const tasks = taskRows
    .filter((r) => String(r.date) === selectedDate)
    .map((r) => toTask(r, sessionsByTask.get(String(r.id)) ?? []));

  // Inbox: tareas sin fecha del contexto actual (independiente de la semana).
  const inbox = (
    await db.execute({
      sql: `SELECT * FROM tasks
            WHERE user_id = ? AND ${f.clause} AND date IS NULL
            ORDER BY "order", created_at`,
      args: [userId, ...f.args],
    })
  ).rows.map((r) => toTask(r, []));

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
    dayTotalSeconds,
    weekTotalSeconds,
    carryOverCount: await countCarryOver(userId, input.fileId),
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

  return rows.map((r) => {
    const date = String(r.date);
    return {
      date,
      day: weekdayNameOf(date) ?? '',
      week: weekLabelOf(mondayOf(date)),
      taskId: String(r.task_id),
      task: String(r.task_name),
      estimateMinutes: r.estimate_min == null ? null : Number(r.estimate_min),
      durationSeconds: Number(r.duration_sec),
      start: String(r.start_hhmm),
      end: String(r.end_hhmm),
    };
  });
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

  if (sets.length === 0) throw new BadRequestError('nothing_to_update', 'Nada que actualizar');

  sets.push('updated_at = ?');
  args.push(new Date().toISOString());

  const res = await getDb().execute({
    sql: `UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    args: [...args, input.taskId, userId] as InValue[],
  });
  if (res.rowsAffected === 0) throw new NotFoundError('task_not_found', 'Tarea no encontrada');
  return result;
}

async function deleteTask(taskId?: string): Promise<void> {
  const userId = currentUserId();
  if (!taskId) throw new BadRequestError('invalid_task_id', 'Falta task_id');
  // El enforcement de FK ON DELETE CASCADE no es fiable por conexión en
  // Turso → borro las sesiones explícitamente.
  await getDb().batch(
    [
      { sql: 'DELETE FROM work_sessions WHERE task_id = ? AND user_id = ?', args: [taskId, userId] },
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

export const sqliteStore: TaskStore = {
  getWeekView,
  getMonthSummary,
  getFocusHeatmap,
  getSessionsInRange,
  listFiles,
  createTask,
  updateTask,
  deleteTask,
  updateTaskPosition,
  carryOverToToday,
  logSession,
  updateSession,
  deleteSession,
  listRecurringRules,
  createRecurringRule,
  updateRecurringRule,
  deleteRecurringRule,
  applyRecurringToWeek,
};
