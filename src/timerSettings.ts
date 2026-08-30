/**
 * Ajustes configurables del pomodoro. 100% cliente — se guardan en
 * localStorage ('pomotion:timer-settings') vía useTimerSettings.ts.
 * Módulo puro (validación + regla del descanso largo), testeado.
 */

export type TimerSettings = {
  /** Minutos de foco por pomodoro. */
  workMinutes: number;
  /** Minutos del descanso corto. */
  shortBreakMinutes: number;
  /** Minutos del descanso largo. */
  longBreakMinutes: number;
  /** Descanso largo cada N pomodoros completados; 0 = nunca. */
  longBreakEvery: number;
  /** Tras un descanso, arrancar el siguiente pomodoro sin pedir "Iniciar". */
  autoStartNext: boolean;
};

export const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  autoStartNext: false,
};

/** [min, max] permitido para cada campo numérico. */
export const TIMER_LIMITS = {
  workMinutes: [1, 180],
  shortBreakMinutes: [1, 60],
  longBreakMinutes: [1, 120],
  longBreakEvery: [0, 12],
} as const;

function clampInt(value: unknown, [min, max]: readonly [number, number], fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Normaliza cualquier entrada (localStorage, patch parcial) a settings válidos. */
export function clampTimerSettings(raw: unknown): TimerSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof TimerSettings, unknown>>;
  return {
    workMinutes: clampInt(o.workMinutes, TIMER_LIMITS.workMinutes, DEFAULT_TIMER_SETTINGS.workMinutes),
    shortBreakMinutes: clampInt(
      o.shortBreakMinutes,
      TIMER_LIMITS.shortBreakMinutes,
      DEFAULT_TIMER_SETTINGS.shortBreakMinutes
    ),
    longBreakMinutes: clampInt(
      o.longBreakMinutes,
      TIMER_LIMITS.longBreakMinutes,
      DEFAULT_TIMER_SETTINGS.longBreakMinutes
    ),
    longBreakEvery: clampInt(
      o.longBreakEvery,
      TIMER_LIMITS.longBreakEvery,
      DEFAULT_TIMER_SETTINGS.longBreakEvery
    ),
    autoStartNext:
      typeof o.autoStartNext === 'boolean' ? o.autoStartNext : DEFAULT_TIMER_SETTINGS.autoStartNext,
  };
}

/**
 * ¿El descanso que sigue al pomodoro nº `completedPomodoros` (1-indexado)
 * es largo? Con `every = 0` nunca lo es.
 */
export function isLongBreakDue(completedPomodoros: number, every: number): boolean {
  return every > 0 && completedPomodoros > 0 && completedPomodoros % every === 0;
}
