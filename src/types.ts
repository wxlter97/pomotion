export type Session = {
  id: string;
  taskId: string;
  durationSeconds: number;
  start: string;
  end: string;
};

/** Prioridad de una tarea; null = sin prioridad. */
export type TaskPriority = 'low' | 'med' | 'high';

export type Task = {
  id: string;
  name: string;
  date: string; // 'YYYY-MM-DD'
  done: boolean;
  order: number;
  file: string | null;
  priority: TaskPriority | null;
  /** Notas libres; null o '' = sin notas. */
  notes: string | null;
  /** Fecha de vencimiento 'YYYY-MM-DD', distinta de la agenda (`date`). */
  due: string | null;
  sessions: Session[];
};

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
  dayTotalSeconds: number;
  weekTotalSeconds: number;
  /** Tareas pendientes de días pasados que se pueden "traer a hoy". */
  carryOverCount: number;
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

export type RecurringRule = {
  id: string;
  name: string;
  file: string | null;
  /** CSV de días 1(Lun)..7(Dom). */
  weekdays: string;
  active: boolean;
};

export type TimerMode = 'pomodoro' | 'free';
export type TimerPhase = 'idle' | 'work' | 'break';

export type Theme = 'light' | 'dark';
