import { useEffect } from 'react';
import { dueNotificationBody } from './dueReminders';
import { notificationPermission, notify } from './notify';
import type { DueReminder } from './types';

const KEY = 'pomotion:due-notified';
const RECHECK_MS = 30 * 60 * 1000;

/** ids ya notificados hoy (se resetea al cambiar el día). */
function loadSeen(today: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && raw.day === today && Array.isArray(raw.ids)) return new Set<string>(raw.ids);
  } catch {
    // ignorar
  }
  return new Set();
}

function saveSeen(today: string, ids: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ day: today, ids: [...ids] }));
  } catch {
    // ignorar
  }
}

/**
 * Dispara una notificación del navegador por las tareas que vencen hoy o ya
 * vencieron, una sola vez por tarea y por día. Solo cuando la pestaña está
 * en segundo plano (con la app abierta ya se ve el banner). Re-chequea al
 * volver a ocultarse la pestaña y cada 30 min (cubre el paso de medianoche
 * si la app queda abierta).
 */
export function useDueNotifications(
  reminders: DueReminder[],
  today: string,
  enabled: boolean
): void {
  const key = reminders.map((r) => r.id).join(',');

  useEffect(() => {
    if (!enabled || !today || reminders.length === 0) return;
    if (notificationPermission() !== 'granted') return;

    function maybeNotify() {
      if (typeof document !== 'undefined' && !document.hidden) return;
      const seen = loadSeen(today);
      const unseen = reminders.filter((r) => !seen.has(r.id));
      if (unseen.length === 0) return;
      notify(dueNotificationBody(unseen), 'pomotion-due');
      for (const r of unseen) seen.add(r.id);
      saveSeen(today, seen);
    }

    maybeNotify();
    document.addEventListener('visibilitychange', maybeNotify);
    const iv = window.setInterval(maybeNotify, RECHECK_MS);
    return () => {
      document.removeEventListener('visibilitychange', maybeNotify);
      window.clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, today, enabled]);
}
