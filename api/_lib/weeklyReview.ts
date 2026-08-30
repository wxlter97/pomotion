/**
 * Agregaciones puras para la Revisión semanal (ROADMAP §11 Tier 2). Operan
 * sobre listas planas (no tocan la DB) → testeadas en weeklyReview.test.ts.
 */

/** Una sesión de la semana revisada (solo lo que se agrega). */
export type ReviewSession = { taskId: string; durationSeconds: number };

/** Una tarea con fecha dentro de la semana revisada. */
export type ReviewTaskRow = {
  id: string;
  name: string;
  date: string;
  done: boolean;
  file: string | null;
};

/** Una tarea sin terminar de la semana, con su tiempo registrado. */
export type ReviewTask = {
  id: string;
  name: string;
  date: string;
  /** Nombre del día ("Lunes"…"Domingo"). */
  day: string;
  file: string | null;
  loggedSeconds: number;
  hasSessions: boolean;
};

export type ReviewTag = {
  tagId: string;
  name: string;
  color: string;
  seconds: number;
};

export type ReviewSummary = {
  /** Tareas con fecha esa semana marcadas hechas. */
  completedCount: number;
  /** Tareas con fecha esa semana (hechas o no). */
  totalCount: number;
  loggedSeconds: number;
  /** Tiempo registrado la semana anterior (para la comparación). */
  previousLoggedSeconds: number;
  /** Tiempo por contexto (`file`); `null` → "Sin contexto". Desc por segundos. */
  byContext: { label: string; file: string | null; seconds: number }[];
  /** Tiempo por etiqueta (una sesión suma a cada etiqueta de su tarea). Desc. */
  byTag: ReviewTag[];
  /** Tareas sin terminar de la semana, por fecha. */
  unfinished: ReviewTask[];
};

const NO_CONTEXT = 'Sin contexto';

/** 0=Lun..6=Dom para 'YYYY-MM-DD', sin corrimiento de zona. */
function weekdayMon0(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export function buildReviewSummary(input: {
  tasks: ReviewTaskRow[];
  sessions: ReviewSession[];
  tagIdsByTask: Map<string, string[]>;
  tags: { id: string; name: string; color: string }[];
  previousLoggedSeconds: number;
}): ReviewSummary {
  const { tasks, sessions, tagIdsByTask, tags, previousLoggedSeconds } = input;

  const secondsByTask = new Map<string, number>();
  for (const s of sessions) {
    secondsByTask.set(s.taskId, (secondsByTask.get(s.taskId) ?? 0) + s.durationSeconds);
  }
  const loggedSeconds = [...secondsByTask.values()].reduce((a, b) => a + b, 0);

  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // Por contexto: el tiempo de cada tarea va a su `file`.
  const byContextMap = new Map<string | null, number>();
  for (const [taskId, secs] of secondsByTask) {
    const file = taskById.get(taskId)?.file ?? null;
    byContextMap.set(file, (byContextMap.get(file) ?? 0) + secs);
  }
  const byContext = [...byContextMap.entries()]
    .map(([file, seconds]) => ({ label: file ?? NO_CONTEXT, file, seconds }))
    .sort((a, b) => b.seconds - a.seconds);

  // Por etiqueta: el tiempo de una tarea suma a TODAS sus etiquetas.
  const tagName = new Map(tags.map((t) => [t.id, t]));
  const byTagMap = new Map<string, number>();
  for (const [taskId, secs] of secondsByTask) {
    for (const tagId of tagIdsByTask.get(taskId) ?? []) {
      byTagMap.set(tagId, (byTagMap.get(tagId) ?? 0) + secs);
    }
  }
  const byTag = [...byTagMap.entries()]
    .map(([tagId, seconds]) => ({
      tagId,
      name: tagName.get(tagId)?.name ?? '(?)',
      color: tagName.get(tagId)?.color ?? 'gray',
      seconds,
    }))
    .sort((a, b) => b.seconds - a.seconds);

  const unfinished: ReviewTask[] = tasks
    .filter((t) => !t.done)
    .map((t) => ({
      id: t.id,
      name: t.name,
      date: t.date,
      day: DAY_NAMES[weekdayMon0(t.date)] ?? '',
      file: t.file,
      loggedSeconds: secondsByTask.get(t.id) ?? 0,
      hasSessions: (secondsByTask.get(t.id) ?? 0) > 0,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));

  return {
    completedCount: tasks.filter((t) => t.done).length,
    totalCount: tasks.length,
    loggedSeconds,
    previousLoggedSeconds,
    byContext,
    byTag,
    unfinished,
  };
}
