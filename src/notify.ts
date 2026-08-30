/**
 * Notificaciones del navegador al cambiar de fase del pomodoro — refuerzo
 * del chime sonoro (src/sound.ts) para cuando la pestaña está en segundo
 * plano y no se ve el timer ni se escucha bien.
 *
 * En iOS/Safari la Notification API solo existe dentro de una PWA
 * instalada; en una pestaña normal `window.Notification` es `undefined` y
 * todo esto es no-op silencioso.
 */

export type PhaseNotification = 'work-done' | 'break-done';

const MESSAGES: Record<PhaseNotification, string> = {
  'work-done': '🍅 Terminó el pomodoro — tomate un descanso.',
  'break-done': '☕ Terminó el descanso — a seguir.',
};

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

/**
 * Pide permiso para notificar. Debe llamarse desde un gesto real del
 * usuario (click en el toggle). Devuelve el estado final del permiso.
 */
export async function requestNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * Dispara la notificación de un cambio de fase. No-op si: no hay soporte,
 * no hay permiso concedido, o la pestaña está visible (ahí ya se ve el
 * timer y suena el chime).
 */
export function notifyPhaseChange(kind: PhaseNotification): void {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  if (typeof document !== 'undefined' && !document.hidden) return;
  try {
    new Notification('pomotion', {
      body: MESSAGES[kind],
      tag: 'pomotion-phase', // reemplaza la anterior en vez de apilar
    });
  } catch {
    // algunos navegadores lanzan si se construye Notification fuera de un
    // contexto permitido (ej. ciertos iframes) — se ignora.
  }
}

/**
 * Notificación genérica de la app. El llamador decide cuándo (a diferencia
 * de `notifyPhaseChange`, acá no se chequea `document.hidden`).
 */
export function notify(body: string, tag: string): void {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    new Notification('pomotion', { body, tag });
  } catch {
    // ver notifyPhaseChange
  }
}
