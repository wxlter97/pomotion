export type Session = {
  id: string;
  taskId: string;
  durationSeconds: number;
  start: string;
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
