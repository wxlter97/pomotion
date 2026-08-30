export type Session = {
  id: string;
  taskId: string;
  durationSeconds: number;
  start: string;
  end: string;
};

/** Prioridad de una tarea; null = sin prioridad. */
export type TaskPriority = 'low' | 'med' | 'high';

/** Procedencia de una tarea: creada a mano o traída de un calendario suscripto. */
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
  /** Notas libres; null o '' = sin notas. */
  notes: string | null;
  /** Fecha de vencimiento 'YYYY-MM-DD', distinta de la agenda (`date`). */
  due: string | null;
  /** Estimación de esfuerzo en minutos; null = sin estimar. */
  estimateMinutes: number | null;
  /** ids de las etiquetas asignadas. */
  tagIds: string[];
  /** 'manual' salvo que la tarea venga de un calendario suscripto. */
  source: TaskSource;
  sessions: Session[];
};

/** Calendario iCal suscripto. */
export type CalendarFeed = {
  id: string;
  name: string;
  url: string;
  file: string | null;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
};

/** Etiqueta / proyecto. `color` es una clave de paleta (ver tags.ts). */
export type Tag = { id: string; name: string; color: string };

/** Un día de la semana visible: su etiqueta ("Lunes") y su fecha. */
export type DayColumn = { day: string; date: string };

export type FileEntry = {
  id: string;
  label: string;
};

export type TasksResponse = {
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
  /** 'YYYY-MM-DD' de hoy en la zona horaria del server. */
  today: string;
  tasks: Task[];
  /** Tareas sin fecha (inbox / backlog) del contexto actual. */
  inbox: Task[];
  /** Todas las etiquetas del usuario. */
  tags: Tag[];
  /** Plantillas de día del usuario. */
  dayTemplates: DayTemplate[];
  dayTotalSeconds: number;
  weekTotalSeconds: number;
  /** Tareas pendientes de días pasados que se pueden "traer a hoy". */
  carryOverCount: number;
};

/** Una tarea encontrada por la búsqueda de texto. */
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
  hasSessions: boolean;
};

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
  days: MonthDaySummary[];
};

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
  weeks: number;
  totalSeconds: number;
  activeDays: number;
  maxSeconds: number;
  days: FocusHeatmapDay[];
};

export type Analytics = {
  weeks: number;
  startDate: string;
  endDate: string;
  totalSeconds: number;
  activeDays: number;
  byWeekday: { label: string; totalSeconds: number }[];
  byHour: { hour: number; totalSeconds: number }[];
  byWeek: { weekStart: string; label: string; totalSeconds: number }[];
  completion: { total: number; done: number };
  streak: { current: number; longest: number };
};

export type RecurringRule = {
  id: string;
  name: string;
  file: string | null;
  /** CSV de días 1(Lun)..7(Dom). */
  weekdays: string;
  active: boolean;
};

export type DayTemplateItem = {
  name: string;
  priority: TaskPriority | null;
  estimateMinutes: number | null;
};

export type DayTemplate = {
  id: string;
  name: string;
  file: string | null;
  items: DayTemplateItem[];
};

export type Goal = {
  id: string;
  tagId: string | null;
  file: string | null;
  targetMinutes: number;
};

export type GoalProgress = Goal & {
  tagName: string | null;
  month: string;
  loggedSeconds: number;
  dayOfMonth: number;
  daysInMonth: number;
};

export type TimerMode = 'pomodoro' | 'free';
export type TimerPhase = 'idle' | 'work' | 'break';

export type Theme = 'light' | 'dark';
