import { useCallback, useState } from 'react';
import { clampBusinessHours, DEFAULT_BUSINESS_HOURS, type BusinessHoursSettings } from './businessHours';

const KEY = 'pomotion:business-hours';

function readStored(): BusinessHoursSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? clampBusinessHours(JSON.parse(raw)) : DEFAULT_BUSINESS_HOURS;
  } catch {
    return DEFAULT_BUSINESS_HOURS;
  }
}

function persist(settings: BusinessHoursSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // localStorage no disponible — vale para esta sesión igual
  }
}

/** Horas hábiles + setter (reemplazo completo, re-clampeado y persistido).
 *  Las mutaciones puntuales (agregar/borrar bloque, etc.) viven en
 *  businessHours.ts — el diálogo las llama y pasa el resultado a `set`. */
export function useBusinessHoursSetting(): [
  BusinessHoursSettings,
  (next: BusinessHoursSettings) => void,
] {
  const [settings, setSettings] = useState<BusinessHoursSettings>(readStored);

  const set = useCallback((next: BusinessHoursSettings) => {
    const clamped = clampBusinessHours(next);
    setSettings(clamped);
    persist(clamped);
  }, []);

  return [settings, set];
}
