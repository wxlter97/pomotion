/**
 * Contrato de dominio para tareas / sesiones / recurrentes, en términos
 * relacionales y sin vocabulario de Notion. Lo implementa `sqliteStore.ts`
 * contra Turso; una futura implementación sobre Postgres sería otro archivo
 * con la misma interfaz.
 *
 * Reglas: nada de `blockId`/`containerId`/"page" acá; ids genéricos, fechas
 * `YYYY-MM-DD`, horas `HH:MM`, duración en segundos. Toda operación se
 * scopea al usuario de `requestContext` — la interfaz no lo recibe.
 */

import type { Analytics } from './analytics.js';
export type { Analytics } from './analytics.js';

export type Session = {
  id: string;
  taskId: string;
  durationSeconds: number;
  start: string; // 'HH:MM'
  end: string;
};

/** Prioridad de una tarea; null = sin prioridad. */
export type TaskPriority = 'low' | 'med' | 'high';

/** Procedencia de una tarea: creada a mano o materializada de un calendario. */
export type TaskSource = 'manual' | 'calendar';

export type Task = {
  id: string;
  name: string;
  /** 'YYYY-MM-DD'; null = sin fecha (inbox / backlog). */
  date: string | null;
  done: boolean;
  order: number;
  file: string | null;
  priority: TaskPriority | null;
  /** Notas libres; null = sin notas. */
  notes: string | null;
  /** Vencimiento 'YYYY-MM-DD', distinto de la agenda (`date`). */
  due: string | null;
  /** Estimación de esfuerzo en minutos; null = sin estimar. */
  estimateMinutes: number | null;
  /** ids de las etiquetas asignadas (ver `Tag`). */
  tagIds: string[];
  /** 'manual' salvo que la tarea venga de un calendario suscripto. */
  source: TaskSource;
  /** ISO-8601 de cuándo se creó la fila (para el chip de "edad"). */
  createdAt: string;
  sessions: Session[];
};

/** Calendario iCal suscripto: se baja cada tanto y sus eventos se vuelven tareas. */
export type CalendarFeed = {
  id: string;
  name: string;
  /** URL .ics; se devuelve completa solo al dueño. */
  url: string;
  /** Bucket destino de las tareas creadas ('Trabajo' / 'Casa' / null). */
  file: string | null;
  enabled: boolean;
  /** ISO del último sync exitoso, o null. */
  lastSyncedAt: string | null;
  /** Último error de sync (sin la URL), o null. */
  lastError: string | null;
};

/** Etiqueta / proyecto. `color` es una clave de paleta (ver src/tags.ts). */
export type Tag = { id: string; name: string; color: string };

/** Un día de la semana visible: su etiqueta ("Lunes") y su fecha. */
export type DayColumn = { day: string; date: string };

/** Tarea sin hacer que vence hoy o ya venció — para el aviso de vencimientos. */
export type DueReminder = { id: string; name: string; due: string };

export type WeekView = {
  /** Etiqueta "2026.08.24 - 2026.08.28". */
  week: string;
  /** Lunes de la semana, 'YYYY-MM-DD'. */
  weekStart: string;
  isCurrentWeek: boolean;
  previousWeekLabel: string;
  nextWeekLabel: string;
  /** Lun–Vie, siempre 5. */
  days: DayColumn[];
  selectedDay: string;
  selectedDate: string;
  /** 'YYYY-MM-DD' de hoy en APP_TIMEZONE. */
  today: string;
  /** Tareas del día seleccionado, ordenadas por `order`. */
  tasks: Task[];
  /** Tareas sin fecha (inbox / backlog) del contexto actual, ordenadas por `order`. */
  inbox: Task[];
  /** Todas las etiquetas del usuario (globales, no dependen del contexto). */
  tags: Tag[];
  /** Plantillas de día del usuario. */
  dayTemplates: DayTemplate[];
  dayTotalSeconds: number;
  weekTotalSeconds: number;
  /** Tareas pendientes (sin sesiones) de días pasados, candidatas a "traer a hoy". */
  carryOverCount: number;
  /** Tareas sin hacer del contexto actual que vencen hoy o ya vencieron, por `due`. */
  dueReminders: DueReminder[];
};

/** Resumen de un día en la vista mensual (solo días con actividad). */
export type MonthDaySummary = {
  date: string; // 'YYYY-MM-DD'
  taskCount: number;
  doneCount: number;
  totalSeconds: number;
};

export type MonthSummary = {
  /** 'YYYY-MM'. */
  month: string;
  previousMonth: string;
  nextMonth: string;
  isCurrentMonth: boolean;
  /** 'YYYY-MM-DD' si hoy cae en este mes, si no null. */
  today: string | null;
  /** Días con tareas y/o sesiones, ordenados por fecha. */
  days: MonthDaySummary[];
};

/** Un día del heatmap de foco (solo días con horas registradas). */
export type FocusHeatmapDay = {
  date: string; // 'YYYY-MM-DD'
  totalSeconds: number;
};

export type FocusHeatmap = {
  /** Lunes de la primera columna, 'YYYY-MM-DD'. */
  startDate: string;
  /** Último día con celda (hoy), 'YYYY-MM-DD'. */
  endDate: string;
  today: string;
  /** Cantidad de columnas (semanas) de la grilla. */
  weeks: number;
  totalSeconds: number;
  /** Días con al menos una sesión en el rango. */
  activeDays: number;
  /** Máximo de segundos registrados en un día del rango (0 si no hay). */
  maxSeconds: number;
  /** Días con horas registradas, ordenados por fecha. */
  days: FocusHeatmapDay[];
};

/** Fila del reporte de tiempo. */
export type SessionRow = {
  date: string;
  day: string;
  week: string;
  taskId: string;
  task: string;
  /** Estimación de la tarea en minutos; null = sin estimar. */
  estimateMinutes: number | null;
  /** ids de las etiquetas de la tarea (para el desglose por etiqueta). */
  tagIds: string[];
  durationSeconds: number;
  start: string;
  end: string;
};

export type FileEntry = { id: string; label: string };

/** Una tarea encontrada por la búsqueda de texto (ver `searchTasks`). */
export type TaskSearchResult = {
  id: string;
  name: string;
  /** 'YYYY-MM-DD'; null = sin fecha (inbox). */
  date: string | null;
  done: boolean;
  file: string | null;
  /** Etiqueta "2026.08.24 - 2026.08.28" para saltar a esa semana; null si es del inbox. */
  weekLabel: string | null;
  /** Nombre del día laboral ("Lunes"); null si es del inbox o cae en fin de semana. */
  day: string | null;
  /** true si la tarea tiene al menos una sesión registrada. */
  hasSessions: boolean;
};

export type RecurringRule = {
  id: string;
  name: string;
  file: string | null;
  /** CSV de días 1(Lun)..7(Dom), ej. "1,2,3,4,5". */
  weekdays: string;
  active: boolean;
};

/** Un ítem de una plantilla de día. */
export type DayTemplateItem = {
  name: string;
  priority: TaskPriority | null;
  estimateMinutes: number | null;
};

/** Plantilla de día: un set de tareas con nombre para "estampar" en un día. */
export type DayTemplate = {
  id: string;
  name: string;
  file: string | null;
  items: DayTemplateItem[];
};

/** Meta mensual: X minutos en una etiqueta (o en todo el contexto). */
export type Goal = {
  id: string;
  /** Etiqueta objetivo; null = todo el contexto. */
  tagId: string | null;
  file: string | null;
  targetMinutes: number;
};

/** Una meta + su progreso en el mes en curso. */
export type GoalProgress = Goal & {
  /** Nombre de la etiqueta (para mostrar), o null. */
  tagName: string | null;
  /** 'YYYY-MM' evaluado. */
  month: string;
  /** Segundos registrados que cuentan para la meta este mes. */
  loggedSeconds: number;
  /** Día del mes de hoy (1..31) y días totales del mes — para el burn-down. */
  dayOfMonth: number;
  daysInMonth: number;
};

// --- Inputs (campos crudos de la request; los valida la implementación) ---

export type GetWeekViewInput = { week?: string; day?: string; fileId?: string };
export type SearchTasksInput = { query?: string; fileId?: string };

/** Valores que sobreviven al round-trip por JSON de una fila de la DB. */
export type BackupValue = string | number | null;

/**
 * Volcado completo del dataset de un usuario (todas las tablas de dominio,
 * sin `user_id`). Formato para el backup / restore manual (ROADMAP §11).
 */
export type Backup = {
  format: 'pomotion-backup';
  version: 1;
  exportedAt: string;
  data: Record<string, Array<Record<string, BackupValue>>>;
};

/** Conteo de filas insertadas por tabla al restaurar. */
export type ImportResult = { imported: Record<string, number> };
export type GetMonthSummaryInput = { month?: string; fileId?: string };
export type GetFocusHeatmapInput = { fileId?: string; weeks?: number };
export type GetAnalyticsInput = { fileId?: string; weeks?: number };
export type ReportInput = { from?: string; to?: string; fileId?: string };

export type CreateTaskInput = {
  /** 'YYYY-MM-DD'; ausente/null = va al inbox (sin fecha). */
  date?: string | null;
  text?: string;
  fileId?: string;
  /** id de la tarea tras la cual insertar; ausente/null = al inicio del día. */
  afterId?: string | null;
};
export type UpdateTaskInput = {
  taskId?: string;
  done?: boolean;
  text?: string;
  /** 'low' | 'med' | 'high' para setear, null para quitar. */
  priority?: TaskPriority | null;
  /** Texto de notas; '' o null para vaciar. */
  notes?: string | null;
  /** 'YYYY-MM-DD' para setear, null para quitar. */
  due?: string | null;
  /** Minutos estimados (entero > 0) para setear, null para quitar. */
  estimateMinutes?: number | null;
  /** Reemplaza el conjunto completo de etiquetas de la tarea. */
  tagIds?: string[];
};

export type CreateTagInput = { name?: string; color?: string };
export type UpdateTagInput = { id?: string; name?: string; color?: string };

export type DayTemplateItemInput = {
  name?: string;
  priority?: TaskPriority | null;
  estimateMinutes?: number | null;
};
export type CreateDayTemplateInput = {
  name?: string;
  fileId?: string;
  /** Ítems explícitos, o… */
  items?: DayTemplateItemInput[];
  /** …tomar como snapshot las tareas de este día ('YYYY-MM-DD'). */
  fromDate?: string;
};
export type UpdateDayTemplateInput = {
  id?: string;
  name?: string;
  /** Si viene, reemplaza todos los ítems. */
  items?: DayTemplateItemInput[];
};
export type ApplyDayTemplateInput = { id?: string; date?: string; fileId?: string };

export type CreateGoalInput = { tagId?: string | null; targetMinutes?: number; fileId?: string };
export type UpdateGoalInput = { id?: string; targetMinutes?: number; tagId?: string | null };

export type CreateCalendarFeedInput = { name?: string; url?: string; fileId?: string | null };
export type UpdateCalendarFeedInput = {
  id?: string;
  name?: string;
  fileId?: string | null;
  enabled?: boolean;
};
/** Resultado agregado de sincronizar uno o varios feeds. */
export type SyncCalendarResult = {
  /** Feeds efectivamente sincronizados (los frescos se saltean por debounce). */
  syncedFeeds: number;
  added: number;
  updated: number;
  removed: number;
  /** true si algún feed cambió algo (para que el cliente refresque). */
  changed: boolean;
};

export type UpdateTaskPositionInput = {
  taskId?: string;
  /**
   * Destino: 'YYYY-MM-DD' para un día (arrastra la fecha de sus sesiones),
   * `null` para mandarla al inbox (sin fecha), `undefined` para no cambiar
   * el día (solo reordenar).
   */
  date?: string | null;
  /** id tras el cual reubicar; ausente/null = al inicio del día destino. */
  afterId?: string | null;
};

export type LogSessionInput = {
  taskId?: string;
  durationSeconds?: number;
  // Timer en vivo: ISO completo, se formatea a "HH:MM" con APP_TIMEZONE.
  startTime?: string;
  endTime?: string;
  // Registro manual: el usuario ya escribió "HH:MM".
  start?: string;
  end?: string;
};
export type UpdateSessionInput = {
  sessionId?: string;
  durationSeconds?: number;
  start?: string;
  end?: string;
};

export type CreateRecurringRuleInput = { name?: string; weekdays?: string; fileId?: string };
export type UpdateRecurringRuleInput = {
  id?: string;
  name?: string;
  weekdays?: string;
  active?: boolean;
};
export type ApplyRecurringInput = { week?: string; fileId?: string };

/** Campos efectivamente aplicados por `updateTask` (para el eco al cliente). */
export type UpdateTaskResult = {
  done?: boolean;
  text?: string;
  priority?: TaskPriority | null;
  notes?: string | null;
  due?: string | null;
  estimateMinutes?: number | null;
  tagIds?: string[];
};

export interface TaskStore {
  getWeekView(input: GetWeekViewInput): Promise<WeekView>;
  /** Resumen por día de un mes: conteo de tareas y horas registradas. */
  getMonthSummary(input: GetMonthSummaryInput): Promise<MonthSummary>;
  /** Horas registradas por día en las últimas N semanas, para el heatmap. */
  getFocusHeatmap(input: GetFocusHeatmapInput): Promise<FocusHeatmap>;
  /** Agregados para el panel de analítica (por día de semana, hora, semana…). */
  getAnalytics(input: GetAnalyticsInput): Promise<Analytics>;
  getSessionsInRange(input: ReportInput): Promise<SessionRow[]>;
  /** Tareas cuyo nombre contiene `query` (todas las semanas + inbox del contexto). */
  searchTasks(input: SearchTasksInput): Promise<TaskSearchResult[]>;
  /** Volcado completo del dataset del usuario, para descargar como backup. */
  exportBackup(): Promise<Backup>;
  /**
   * Restaura un backup. v1: solo si la cuenta está vacía (sin tareas, tags,
   * reglas, plantillas, metas ni calendarios) — si no, lanza ConflictError.
   */
  importBackup(input: { backup: unknown }): Promise<ImportResult>;
  listFiles(): Promise<FileEntry[]>;
  listTags(): Promise<Tag[]>;
  createTag(input: CreateTagInput): Promise<Tag>;
  updateTag(input: UpdateTagInput): Promise<Tag>;
  deleteTag(id?: string): Promise<void>;

  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(input: UpdateTaskInput): Promise<UpdateTaskResult>;
  deleteTask(taskId?: string): Promise<void>;
  updateTaskPosition(input: UpdateTaskPositionInput): Promise<{ id: string }>;
  /** Trae a hoy las tareas pendientes sin sesiones de días pasados. */
  carryOverToToday(input: { fileId?: string }): Promise<{ moved: number }>;

  logSession(input: LogSessionInput): Promise<Session>;
  updateSession(input: UpdateSessionInput): Promise<Session>;
  deleteSession(sessionId?: string): Promise<void>;

  listRecurringRules(): Promise<RecurringRule[]>;
  createRecurringRule(input: CreateRecurringRuleInput): Promise<RecurringRule>;
  updateRecurringRule(input: UpdateRecurringRuleInput): Promise<RecurringRule>;
  deleteRecurringRule(id?: string): Promise<void>;
  applyRecurringToWeek(input: ApplyRecurringInput): Promise<{ added: number }>;

  createDayTemplate(input: CreateDayTemplateInput): Promise<DayTemplate>;
  updateDayTemplate(input: UpdateDayTemplateInput): Promise<DayTemplate>;
  deleteDayTemplate(id?: string): Promise<void>;
  /** "Estampa" la plantilla en un día: crea sus tareas (dedup por nombre). */
  applyDayTemplate(input: ApplyDayTemplateInput): Promise<{ added: number }>;

  /** Metas del usuario con su progreso en el mes en curso. */
  listGoals(): Promise<GoalProgress[]>;
  createGoal(input: CreateGoalInput): Promise<Goal>;
  updateGoal(input: UpdateGoalInput): Promise<Goal>;
  deleteGoal(id?: string): Promise<void>;

  /** Calendarios iCal suscriptos del usuario. */
  listCalendarFeeds(): Promise<CalendarFeed[]>;
  createCalendarFeed(input: CreateCalendarFeedInput): Promise<CalendarFeed>;
  updateCalendarFeed(input: UpdateCalendarFeedInput): Promise<CalendarFeed>;
  /** Borra el feed y sus tareas sin tocar (las que tienen sesiones quedan huérfanas). */
  deleteCalendarFeed(id?: string): Promise<void>;
  /**
   * Baja y materializa los feeds habilitados. `feedId` para forzar uno solo
   * (ignora el debounce); sin él, sincroniza todos los que estén vencidos.
   */
  syncCalendarFeeds(input: { feedId?: string; force?: boolean }): Promise<SyncCalendarResult>;
}
