import type { TimerMode, TimerPhase } from './types';

/**
 * Persistencia del timer activo en localStorage, para sobrevivir un
 * refresh, cierre accidental de tab, o bloqueo de pantalla en el celular
 * sin perder el `startedAt` de la sesión en curso.
 *
 * Robustez: solo se restaura si es del MISMO día calendario y no pasó
 * demasiado tiempo — evita resucitar un timer "zombie" de hace días si
 * quedó una tab de fondo abierta. Cualquier entrada corrupta o vieja se
 * limpia sola al leerla (no hace falta un job de limpieza aparte).
 */

const KEY = 'pomotion:active-timer';
const MAX_AGE_MS = 20 * 60 * 60 * 1000; // 20h: generoso para un día laboral, corta lo demás

export type PersistedTimer = {
  taskId: string;
  taskName: string;
  mode: TimerMode;
  phase: Exclude<TimerPhase, 'idle'>;
  startedAt: number; // epoch ms
  date: string;
};

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

export function saveActiveTimer(state: PersistedTimer): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // localStorage no disponible (modo privado, cuota llena, etc.) — no es fatal.
  }
}

export function clearActiveTimer(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignorar
  }
}

export function loadActiveTimer(): PersistedTimer | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedTimer>;
    if (
      !parsed ||
      typeof parsed.taskId !== 'string' ||
      typeof parsed.startedAt !== 'number' ||
      (parsed.phase !== 'work' && parsed.phase !== 'break') ||
      (parsed.mode !== 'pomodoro' && parsed.mode !== 'free')
    ) {
      clearActiveTimer();
      return null;
    }

    const startedAt = new Date(parsed.startedAt);
    const now = new Date();
    const age = now.getTime() - parsed.startedAt;

    if (age < 0 || age > MAX_AGE_MS || !isSameCalendarDay(startedAt, now)) {
      clearActiveTimer();
      return null;
    }

    return parsed as PersistedTimer;
  } catch {
    clearActiveTimer();
    return null;
  }
}
