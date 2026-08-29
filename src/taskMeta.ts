/**
 * Helpers puros para los metadatos de una tarea: prioridad, vencimiento.
 * Sin dependencias de React ni del almacén.
 */
import { formatDurationLabel, parseDurationToSeconds } from './duration';
import type { TaskPriority } from './types';

const MONTH_ABBR = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const;

/** Opciones de prioridad, de mayor a menor (orden para los botones). */
export const PRIORITY_OPTIONS: { level: TaskPriority; label: string }[] = [
  { level: 'high', label: 'Alta' },
  { level: 'med', label: 'Media' },
  { level: 'low', label: 'Baja' },
];

export function priorityLabel(priority: TaskPriority | null): string {
  return PRIORITY_OPTIONS.find((p) => p.level === priority)?.label ?? 'Sin prioridad';
}

/** "3 sep" a partir de "YYYY-MM-DD". */
export function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${Number(d)} ${MONTH_ABBR[Number(m) - 1]}`;
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

/**
 * Etiqueta larga para tooltips / panel de detalle: "vence hoy",
 * "venció ayer", "vence mañana", o "vence 3 sep" / "venció 3 sep".
 */
export function dueLabel(due: string, today: string): string {
  const diff = daysBetween(today, due);
  if (diff === 0) return 'vence hoy';
  if (diff === 1) return 'vence mañana';
  if (diff === -1) return 'venció ayer';
  return `${diff < 0 ? 'venció' : 'vence'} ${shortDate(due)}`;
}

/** Etiqueta compacta para el chip en la fila: "hoy" / "ayer" / "mañana" / "3 sep". */
export function dueChipLabel(due: string, today: string): string {
  const diff = daysBetween(today, due);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff === -1) return 'ayer';
  return shortDate(due);
}

// --- Estimación vs. real ---

/**
 * Interpreta lo que el usuario escribe en el campo de estimación ("90",
 * "1h 30m") y lo devuelve en minutos enteros, o null si está vacío / no
 * matchea ningún formato. Comparte el parser con la duración de sesiones.
 */
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
 * Texto que va en la fila combinando lo registrado con la estimación:
 * - sin estimación: sólo lo registrado ("1h 20m"), o null si no hay nada.
 * - con estimación y algo registrado: "1h 20m / 2h".
 * - con estimación y nada registrado: "est. 2h".
 * `over` = se pasó de la estimación (para pintarlo en rojo).
 */
export function taskTimeSummary(
  totalSeconds: number,
  estimateMinutes: number | null
): { text: string; over: boolean } | null {
  if (estimateMinutes == null) {
    return totalSeconds > 0 ? { text: formatDurationLabel(totalSeconds), over: false } : null;
  }
  const estSeconds = estimateMinutes * 60;
  const over = totalSeconds > estSeconds;
  const text =
    totalSeconds > 0
      ? `${formatDurationLabel(totalSeconds)} / ${formatDurationLabel(estSeconds)}`
      : `est. ${formatDurationLabel(estSeconds)}`;
  return { text, over };
}
