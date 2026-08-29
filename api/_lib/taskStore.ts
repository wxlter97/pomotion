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

export type Session = {
  id: string;
  taskId: string;
  durationSeconds: number;
  start: string; // 'HH:MM'
  end: string;
};

/** Prioridad de una tarea; null = sin prioridad. */
export type TaskPriority = 'low' | 'med' | 'high';

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
  sessions: Session[];
};

/** Etiqueta / proyecto. `color` es una clave de paleta (ver src/tags.ts). */
export type Tag = { id: string; name: string; color: string };

/** Un día de la semana visible: su etiqueta ("Lunes") y su fecha. */
export type DayColumn = { day: string; date: string };

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
  dayTotalSeconds: number;
  weekTotalSeconds: number;
  /** Tareas pendientes (sin sesiones) de días pasados, candidatas a "traer a hoy". */
  carryOverCount: number;
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

export type RecurringRule = {
  id: string;
  name: string;
  file: string | null;
  /** CSV de días 1(Lun)..7(Dom), ej. "1,2,3,4,5". */
  weekdays: string;
  active: boolean;
};

// --- Inputs (campos crudos de la request; los valida la implementación) ---

export type GetWeekViewInput = { week?: string; day?: string; fileId?: string };
export type GetMonthSummaryInput = { month?: string; fileId?: string };
export type GetFocusHeatmapInput = { fileId?: string; weeks?: number };
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
  getSessionsInRange(input: ReportInput): Promise<SessionRow[]>;
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
}
