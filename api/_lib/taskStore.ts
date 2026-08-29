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
  getSessionsInRange(input: ReportInput): Promise<SessionRow[]>;
  listFiles(): Promise<FileEntry[]>;

  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(input: UpdateTaskInput): Promise<{ done?: boolean; text?: string }>;
  deleteTask(taskId?: string): Promise<void>;
  updateTaskPosition(input: UpdateTaskPositionInput): Promise<{ id: string }>;

  logSession(input: LogSessionInput): Promise<Session>;
  updateSession(input: UpdateSessionInput): Promise<Session>;
  deleteSession(sessionId?: string): Promise<void>;

  listRecurringRules(): Promise<RecurringRule[]>;
  createRecurringRule(input: CreateRecurringRuleInput): Promise<RecurringRule>;
  updateRecurringRule(input: UpdateRecurringRuleInput): Promise<RecurringRule>;
  deleteRecurringRule(id?: string): Promise<void>;
  applyRecurringToWeek(input: ApplyRecurringInput): Promise<{ added: number }>;
}
