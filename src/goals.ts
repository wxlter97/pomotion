/**
 * Estado / burn-down de una meta mensual. Puro, sin React.
 */
import type { GoalProgress } from './types';

export type GoalStatus = {
  targetSeconds: number;
  /** loggedSeconds / targetSeconds, sin recortar (puede pasar 1). */
  progress: number;
  /** 0..100 para la barra. */
  progressPct: number;
  /** Ritmo lineal esperado a la fecha. */
  expectedSeconds: number;
  /** logged − esperado (positivo = adelantado). */
  paceDeltaSeconds: number;
  remainingSeconds: number;
  state: 'done' | 'ahead' | 'behind' | 'on-track';
};

// Dentro de ±5% del objetivo se considera "en ritmo".
const ON_TRACK_TOLERANCE = 0.05;

export function goalStatus(g: GoalProgress): GoalStatus {
  const targetSeconds = Math.max(0, g.targetMinutes * 60);
  const monthFraction = g.daysInMonth > 0 ? Math.min(1, g.dayOfMonth / g.daysInMonth) : 1;
  const expectedSeconds = targetSeconds * monthFraction;
  const paceDeltaSeconds = g.loggedSeconds - expectedSeconds;
  const remainingSeconds = Math.max(0, targetSeconds - g.loggedSeconds);
  const progress = targetSeconds > 0 ? g.loggedSeconds / targetSeconds : 0;

  let state: GoalStatus['state'];
  if (g.loggedSeconds >= targetSeconds && targetSeconds > 0) state = 'done';
  else if (Math.abs(paceDeltaSeconds) <= targetSeconds * ON_TRACK_TOLERANCE) state = 'on-track';
  else state = paceDeltaSeconds > 0 ? 'ahead' : 'behind';

  return {
    targetSeconds,
    progress,
    progressPct: Math.max(0, Math.min(100, Math.round(progress * 100))),
    expectedSeconds,
    paceDeltaSeconds,
    remainingSeconds,
    state,
  };
}

export function goalLabel(g: GoalProgress, allTasksLabel = 'Todas las tareas'): string {
  return g.tagName ?? allTasksLabel;
}
