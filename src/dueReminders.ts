/**
 * Helpers puros para el aviso de vencimientos: el texto del banner en la
 * app y el cuerpo de la notificación del navegador. Sin React ni almacén.
 */
import type { DueReminder } from './types';

/** "1 tarea vencida" / "2 tareas vencen hoy" / "3 tareas vencen hoy o ya vencieron". */
export function dueBannerText(reminders: DueReminder[], today: string): string {
  const n = reminders.length;
  if (n === 0) return '';
  const overdue = reminders.filter((r) => r.due < today).length;
  const noun = n === 1 ? 'tarea' : 'tareas';
  if (overdue === n) return `${n} ${noun} ${n === 1 ? 'vencida' : 'vencidas'}.`;
  if (overdue === 0) return `${n} ${noun} ${n === 1 ? 'vence' : 'vencen'} hoy.`;
  return `${n} ${noun} vencen hoy o ya vencieron.`;
}

/** Cuerpo de la notificación del navegador: nombres, recortado a 3. */
export function dueNotificationBody(reminders: DueReminder[]): string {
  const names = reminders.map((r) => r.name);
  if (names.length === 1) return `«${names[0]}» vence hoy o ya venció.`;
  const head = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${names.length} tareas: ${head}…` : `${names.length} tareas: ${head}.`;
}
