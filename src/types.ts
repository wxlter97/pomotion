export type Session = {
  blockId: string | undefined;
  durationMinutes: number;
  start: string;
  end: string;
};

export type Task = {
  blockId: string;
  text: string;
  checked: boolean;
  day: string;
  sessions: Session[];
};

export type WeekSource = 'auto-matched' | 'auto-fallback' | 'requested';

export type FileEntry = {
  id: string;
  label: string;
};

export type TasksResponse = {
  // null: el archivo activo todavía no tiene ninguna semana (ej. recién
  // creado) — distinto de una semana existente sin desglose por día.
  week: string | null;
  weekSource: WeekSource;
  isCurrentWeek: boolean;
  previousWeekLabel: string | null;
  nextWeekLabel: string | null;
  availableDays: string[];
  selectedDay: string | null;
  dayMatched: boolean;
  dayContainerId: string | null;
  dayHeadingBlockId: string | null;
  tasks: Task[];
};

export type TimerMode = 'pomodoro' | 'free';
export type TimerPhase = 'idle' | 'work' | 'break';

export type Theme = 'light' | 'dark';
