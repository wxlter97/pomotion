/**
 * Helpers puros para los metadatos de una tarea: prioridad, vencimiento,
 * edad. Reciben un `t` (y a veces el idioma) para no depender del idioma.
 */
import { formatDurationLabel, parseDurationToSeconds } from './duration';
import { monthAbbr, type Lang, type MsgKey, type TFn } from './i18n';
import type { TaskPriority } from './types';

/** Opciones de prioridad, de mayor a menor (orden para los botones). */
export const PRIORITY_OPTIONS: { level: TaskPriority; labelKey: MsgKey }[] = [
  { level: 'high', labelKey: 'meta.priorityHigh' },
  { level: 'med', labelKey: 'meta.priorityMed' },
  { level: 'low', labelKey: 'meta.priorityLow' },
];

export function priorityLabel(priority: TaskPriority | null, t: TFn): string {
  const opt = PRIORITY_OPTIONS.find((p) => p.level === priority);
  return opt ? t(opt.labelKey) : t('meta.noPriority');
}

/** "3 sep" / "Sep 3" a partir de "YYYY-MM-DD". */
export function shortDate(dateStr: string, lang: Lang): string {
  const [, m, d] = dateStr.split('-');
  const abbr = monthAbbr(Number(m) - 1, lang);
  return lang === 'en' ? `${abbr} ${Number(d)}` : `${Number(d)} ${abbr}`;
}

/** Días entre `from` y `to` ("YYYY-MM-DD"), en UTC. Negativo si `to` es antes. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Una tarea sin hacer con `due` anterior a hoy está vencida. */
export function isOverdue(due: string | null, done: boolean, today: string): boolean {
  return due != null && !done && due < today;
}

/** Etiqueta larga para tooltips / panel: "vence hoy", "venció 3 sep", etc. */
export function dueLabel(due: string, today: string, t: TFn, lang: Lang): string {
  const diff = daysBetween(today, due);
  if (diff === 0) return t('meta.dueToday');
  if (diff === 1) return t('meta.dueTomorrow');
  if (diff === -1) return t('meta.dueYesterday');
  return t(diff < 0 ? 'meta.overdueOn' : 'meta.dueOn', { date: shortDate(due, lang) });
}

/** Etiqueta compacta para el chip: "hoy" / "ayer" / "mañana" / "3 sep". */
export function dueChipLabel(due: string, today: string, t: TFn, lang: Lang): string {
  const diff = daysBetween(today, due);
  if (diff === 0) return t('meta.chipToday');
  if (diff === 1) return t('meta.chipTomorrow');
  if (diff === -1) return t('meta.chipYesterday');
  return shortDate(due, lang);
}

// --- Edad de la tarea ---

/** A partir de cuántos días una tarea abierta muestra el chip de "edad". */
export const TASK_AGE_MIN_DAYS = 7;

/** Chip compacto: "9d" hasta ~2 semanas, después "3sem". `null` si es nueva. */
export function taskAgeLabel(createdAt: string, today: string, t: TFn): string | null {
  const days = daysBetween(createdAt.slice(0, 10), today);
  if (days < TASK_AGE_MIN_DAYS) return null;
  if (days < 14) return t('meta.ageDays', { n: days });
  return t('meta.ageWeeks', { n: Math.round(days / 7) });
}

/** Texto largo para el tooltip del chip: "Abierta hace 9 días". */
export function taskAgeTitle(createdAt: string, today: string, t: TFn): string {
  const days = daysBetween(createdAt.slice(0, 10), today);
  return t('meta.ageTitle', {
    n: days,
    word: t(days === 1 ? 'meta.ageDayWord' : 'meta.ageDaysWord'),
  });
}

// --- Estimación vs. real ---

/** Interpreta "90" / "1h 30m" y devuelve minutos enteros, o null. */
export function parseEstimateMinutes(input: string): number | null {
  const seconds = parseDurationToSeconds(input);
  if (seconds == null || seconds <= 0) return null;
  return Math.max(1, Math.round(seconds / 60));
}

/** "1h 30m" a partir de minutos; '' si es null. */
export function estimateLabel(minutes: number | null): string {
  return minutes == null ? '' : formatDurationLabel(minutes * 60);
}

/**
 * Texto de la fila combinando lo registrado con la estimación.
 * `over` = se pasó de la estimación (para pintarlo en rojo).
 */
export function taskTimeSummary(
  totalSeconds: number,
  estimateMinutes: number | null,
  t: TFn
): { text: string; over: boolean } | null {
  if (estimateMinutes == null) {
    return totalSeconds > 0 ? { text: formatDurationLabel(totalSeconds), over: false } : null;
  }
  const estSeconds = estimateMinutes * 60;
  const over = totalSeconds > estSeconds;
  const text =
    totalSeconds > 0
      ? `${formatDurationLabel(totalSeconds)} / ${formatDurationLabel(estSeconds)}`
      : t('meta.estPrefix', { value: formatDurationLabel(estSeconds) });
  return { text, over };
}
