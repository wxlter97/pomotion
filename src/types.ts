export type Session = {
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

export type TasksResponse = {
  week: string;
  weekMatched: boolean;
  availableDays: string[];
  selectedDay: string;
  dayMatched: boolean;
  tasks: Task[];
};

export type TimerMode = 'pomodoro' | 'free';
