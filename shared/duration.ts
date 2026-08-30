// Reglas de duración y hora compartidas entre cliente (src/) y servidor
// (api/): un solo lugar de verdad para el formato "HH:MM", el parseo de
// duración en formato Jira ("1h 30m 45s") y su formato de vuelta a texto.
//
// La unidad canónica de duración son los SEGUNDOS (no minutos) — pensado
// también de cara a una futura migración fuera de Notion: si algún día
// esto pasa a vivir en una base de datos real, "duration_seconds" es la
// columna natural, y todo el código ya habla en esos términos desde ahora.

export const TIME_RE = /^\d{1,2}:\d{2}$/;

export function isValidTimeLabel(value: string): boolean {
  return TIME_RE.test(value.trim());
}

/** Zero-padea la hora de una "HH:MM" válida ("9:05" → "09:05") para que
 *  ordene bien como texto; `null` si `value` no matchea `TIME_RE`. */
export function normalizeTimeLabel(value: string): string | null {
  const trimmed = value.trim();
  if (!TIME_RE.test(trimmed)) return null;
  const [h, m] = trimmed.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

const PLAIN_NUMBER_RE = /^\d+(\.\d+)?$/;
const JIRA_DURATION_RE = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m)?\s*(?:(\d+(?:\.\d+)?)\s*s)?$/i;

/**
 * Convierte un string de duración a segundos totales, exactos (sin
 * redondear intermedio).
 * - Número plano ("90", "1.5"): se interpreta como MINUTOS, igual que el
 *   campo numérico que existía antes de admitir formato Jira.
 * - Formato tipo Jira ("1h 30m 45s", "1h30m", "45s", "2h", ...): se suman
 *   las partes en el orden h/m/s.
 * Devuelve `null` si el string está vacío o no matchea ningún formato.
 */
export function parseDurationToSeconds(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (PLAIN_NUMBER_RE.test(trimmed)) {
    return Number(trimmed) * 60;
  }

  const match = trimmed.replace(/\s+/g, ' ').match(JIRA_DURATION_RE);
  if (!match) return null;
  const [, h, m, s] = match;
  if (h === undefined && m === undefined && s === undefined) return null;

  return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
}

/** Redondea a segundos enteros y aplica el mínimo de 1s (nunca 0 ni negativo). */
export function roundDurationSeconds(seconds: number): number {
  return Math.max(1, Math.round(seconds));
}

/**
 * Formatea segundos totales a una etiqueta compacta tipo Jira, omitiendo
 * las partes en cero (ej. 5400 → "1h 30m", 45 → "45s", 0 → "0m").
 *
 * Es la MISMA función que arma el texto guardado en Notion (ver
 * formatSessionText en api/_lib/sessionText.ts) y la que se usa para mostrar la
 * duración en la UI — así los dos lugares quedan siempre consistentes: una
 * duración de minutos exactos se ve idéntica al formato legado ("25m"), y
 * solo aparecen "h"/"s" cuando efectivamente hacen falta.
 */
export function formatDurationLabel(totalSeconds: number): string {
  const rounded = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0) parts.push(`${s}s`);
  return parts.length > 0 ? parts.join(' ') : '0m';
}
