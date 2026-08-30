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

/** Un paso marcable dentro de una tarea (subtarea / checklist), sin tiempo propio. */
export type ChecklistItem = { id: string; text: string; done: boolean };

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
  /** Hora planeada 'HH:MM' (time-blocking v1); null = sin horario. */
  plannedStart: string | null;
  /** Duración del bloque en minutos (redimensionado a mano en el timeline);
   *  null = usa `estimateMinutes` o el default del timeline. */
  plannedMinutes: number | null;
  /** ids de las etiquetas asignadas. */
  tagIds: string[];
  /** 'manual' salvo que la tarea venga de un calendario suscripto. */
  source: TaskSource;
  /** ISO-8601 de cuándo se creó la tarea (para el chip de "edad"). */
  createdAt: string;
  /** Pasos marcables de la tarea (sin tiempo propio); lista vacía = sin checklist. */
  checklist: ChecklistItem[];
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

/** Tarea sin hacer que vence hoy o ya venció. */
export type DueReminder = { id: string; name: string; due: string };

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
  /** Tareas sin hacer del contexto que vencen hoy o ya vencieron. */
  dueReminders: DueReminder[];
  /** Bitácora del día seleccionado (texto libre); '' si no hay nada escrito. */
  dayNote: string;
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
  estimateAccuracy: EstimateAccuracy | null;
};

/** Precisión de las estimaciones sobre las tareas completadas de la ventana. */
export type EstimateAccuracy = {
  count: number;
  totalEstimatedSeconds: number;
  totalLoggedSeconds: number;
  /** registrado / estimado. >1 = subestimás. */
  ratio: number;
  /** (ratio − 1) × 100. + = subestimás, − = sobreestimás. */
  biasPct: number;
  /** Factor sugerido para multiplicar futuras estimaciones. */
  suggestedFactor: number;
};

/** Una tarea sin terminar de la semana revisada (ver WeeklyReview). */
export type ReviewTask = {
  id: string;
  name: string;
  date: string;
  day: string;
  file: string | null;
  loggedSeconds: number;
  hasSessions: boolean;
};

/** Datos de la Revisión semanal (panel guiado de fin de semana). */
export type WeeklyReview = {
  week: string;
  weekStart: string;
  previousWeekLabel: string;
  nextWeekLabel: string;
  isCurrentWeek: boolean;
  nextWeekStart: string;
  completedCount: number;
  totalCount: number;
  loggedSeconds: number;
  previousLoggedSeconds: number;
  byContext: { label: string; file: string | null; seconds: number }[];
  byTag: { tagId: string; name: string; color: string; seconds: number }[];
  unfinished: ReviewTask[];
  /** Foco fijado para la semana revisada (referencia). */
  thisFocus: string;
  /** Foco fijado para la semana siguiente (editable en el panel). */
  nextFocus: string;
};

export type RecurringFreq = 'weekly' | 'monthly';

export type RecurringRule = {
  id: string;
  name: string;
  file: string | null;
  active: boolean;
  /** 'weekly' usa `weekdays`; 'monthly' usa `monthdays`. */
  freq: RecurringFreq;
  /** CSV de días 1(Lun)..7(Dom). */
  weekdays: string;
  /** CSV de días del mes 1..31, más `-1` = último día. '' si la regla es weekly. */
  monthdays: string;
  /** Hora 'HH:MM' con la que nacen las tareas que genera esta regla; null = sin horario. */
  defaultPlannedStart: string | null;
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

/** Volcado completo del dataset del usuario (backup manual). */
export type Backup = {
  format: 'pomotion-backup';
  version: 1;
  exportedAt: string;
  data: Record<string, Array<Record<string, string | number | null>>>;
};

export type TimerMode = 'pomodoro' | 'free';
export type TimerPhase = 'idle' | 'work' | 'break';

export type Theme = 'light' | 'dark';
