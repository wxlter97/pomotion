// Helpers puros para el registro de sesiones manuales: parseo de duración
// (número plano de minutos o formato tipo Jira, ej. "1h 30m 45s") y cálculo
// de la hora de fin a partir de inicio + duración.

const PLAIN_NUMBER_RE = /^\d+(\.\d+)?$/;
const JIRA_DURATION_RE = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m)?\s*(?:(\d+(?:\.\d+)?)\s*s)?$/i;

/**
 * Convierte un string de duración a minutos totales.
 * - Número plano ("90", "1.5"): se interpreta como minutos, sin redondear
 *   (idéntico al comportamiento previo, que hacía `Number(draft.duration)`).
 * - Formato tipo Jira ("1h 30m 45s", "1h30m", "45s", "2h", ...): se suman
 *   las partes y se redondea una sola vez al final.
 * Devuelve `null` si el string está vacío o no matchea ningún formato.
 */
export function parseDurationToMinutes(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (PLAIN_NUMBER_RE.test(trimmed)) {
    return Number(trimmed);
  }

  const match = trimmed.replace(/\s+/g, ' ').match(JIRA_DURATION_RE);
  if (!match) return null;
  const [, h, m, s] = match;
  if (h === undefined && m === undefined && s === undefined) return null;

  const totalMinutes = Number(h ?? 0) * 60 + Number(m ?? 0) + Number(s ?? 0) / 60;
  return Math.round(totalMinutes);
}

/** Hora actual del navegador, formato "HH:MM" (24h, con padding de ceros). */
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
