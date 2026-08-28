// Helpers de duración/hora específicos del cliente. Las reglas compartidas
// con el servidor (parseo de duración, formato, TIME_RE) viven en
// ../shared/duration — este módulo las reexporta y agrega lo que solo
// tiene sentido en el navegador: la hora actual y la aritmética sobre
// horas "HH:MM" para el auto-cálculo de la hora de fin.
export {
  TIME_RE,
  formatDurationLabel,
  isValidTimeLabel,
  parseDurationToSeconds,
  roundDurationSeconds,
} from '../shared/duration';

/** Hora actual del navegador, "HH:MM" (24h, con padding de ceros). */
export function nowAsHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Suma `minutes` a una hora "HH:MM", con rollover de medianoche (ej.
 * "23:45" + 30 → "00:15"). Si `hhmm` no tiene el formato esperado, se
 * devuelve sin cambios (respaldo defensivo; el llamador ya valida el
 * formato antes de invocar esta función).
 */
export function addMinutesToTime(hhmm: string, minutes: number): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return hhmm;
  const totalStart = Number(match[1]) * 60 + Number(match[2]);
  const total = ((Math.round(totalStart + minutes) % 1440) + 1440) % 1440;
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
