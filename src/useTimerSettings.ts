import { useCallback, useState } from 'react';
import { clampTimerSettings, DEFAULT_TIMER_SETTINGS, type TimerSettings } from './timerSettings';

const KEY = 'pomotion:timer-settings';

function readStored(): TimerSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? clampTimerSettings(JSON.parse(raw)) : DEFAULT_TIMER_SETTINGS;
  } catch {
    return DEFAULT_TIMER_SETTINGS;
  }
}

function persist(settings: TimerSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // localStorage no disponible — vale para esta sesión igual
  }
}

/** Ajustes del pomodoro + `update` (merge parcial, re-clampeado) y `reset`. */
export function useTimerSettings(): [
  TimerSettings,
  (patch: Partial<TimerSettings>) => void,
  () => void,
] {
  const [settings, setSettings] = useState<TimerSettings>(readStored);

  const update = useCallback((patch: Partial<TimerSettings>) => {
    setSettings((prev) => {
      const next = clampTimerSettings({ ...prev, ...patch });
      persist(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSettings(DEFAULT_TIMER_SETTINGS);
    persist(DEFAULT_TIMER_SETTINGS);
  }, []);

  return [settings, update, reset];
}
