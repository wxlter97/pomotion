/**
 * Helpers puros para los metadatos de una tarea: prioridad, vencimiento.
 * Sin dependencias de React ni del almacén.
 */
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
