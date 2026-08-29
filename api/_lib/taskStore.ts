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

export type Task = {
  id: string;
  name: string;
  date: string; // 'YYYY-MM-DD'
  done: boolean;
  order: number;
  file: string | null;
  sessions: Session[];
};

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
  /** Tareas del día seleccionado, ordenadas por `order`. */
  tasks: Task[];
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
  task: string;
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
  date?: string;
  text?: string;
  fileId?: string;
  /** id de la tarea tras la cual insertar; ausente/null = al inicio del día. */
  afterId?: string | null;
};
export type UpdateTaskInput = { taskId?: string; done?: boolean; text?: string };
export type UpdateTaskPositionInput = {
  taskId?: string;
  /** Nuevo día (mover entre días). Si cambia, arrastra la fecha de sus sesiones. */
  date?: string;
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

export interface TaskStore {
  getWeekView(input: GetWeekViewInput): Promise<WeekView>;
  /** Resumen por día de un mes: conteo de tareas y horas registradas. */
  getMonthSummary(input: GetMonthSummaryInput): Promise<MonthSummary>;
  /** Horas registradas por día en las últimas N semanas, para el heatmap. */
  getFocusHeatmap(input: GetFocusHeatmapInput): Promise<FocusHeatmap>;
  getSessionsInRange(input: ReportInput): Promise<SessionRow[]>;
  listFiles(): Promise<FileEntry[]>;

  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(input: UpdateTaskInput): Promise<{ done?: boolean; text?: string }>;
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
