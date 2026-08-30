/**
 * Helpers puros para el aviso de vencimientos: el texto del banner en la
 * app y el cuerpo de la notificación del navegador. Sin React ni almacén —
 * reciben un `t` para no depender del idioma.
 */
import type { TFn as T } from './i18n';
import type { DueReminder } from './types';

/** Texto del banner de vencimientos ('' si no hay ninguno). */
export function dueBannerText(reminders: DueReminder[], _today: string, t: T): string {
  const n = reminders.length;
  if (n === 0) return '';
  return n === 1 ? t('due.one', { name: reminders[0].name }) : t('due.many', { count: n });
}

/** Cuerpo de la notificación del navegador: nombres, recortado a 3. */
export function dueNotificationBody(reminders: DueReminder[], t: T): string {
  const names = reminders.map((r) => r.name);
  if (names.length === 1) return t('due.one', { name: names[0] });
  const head = names.slice(0, 3).join(', ');
  return t('due.notifyMany', {
    count: names.length,
    names: names.length > 3 ? `${head}…` : `${head}.`,
  });
}
