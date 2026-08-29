// Formato de una sesión registrada tal como se guarda en Notion:
//   "⏱ 25m (10:15–10:40)"            (formato legado, solo minutos)
//   "⏱ 1h 30m 45s (10:15–10:40)"     (con precisión de segundos)
//
// Este módulo es el único lugar de verdad de ese formato de "wire": lo
// escribe (formatSessionText) y lo lee (parseSessionText) la misma pieza,
// así los dos lados no se pueden desincronizar. Si algún día el
// almacenamiento deja de ser texto en Notion, esto es lo que se reemplaza.

import { formatDurationLabel, parseDurationToSeconds, roundDurationSeconds } from '../../shared/duration.js';

/** Arma el texto de la sesión a partir de la duración en segundos y las horas ya formateadas ("HH:MM"). */
export function formatSessionText(durationSeconds: number, start: string, end: string): string {
  return `⏱ ${formatDurationLabel(durationSeconds)} (${start}–${end})`;
}

// El primer grupo captura el token de duración tal cual (sin asumir su
// forma) — se interpreta con parseDurationToSeconds, el mismo parser que
// lee lo que el usuario escribe en el formulario. El separador de horas
// acepta guión largo o normal.
const SESSION_RE = /⏱\s*([^()]+?)\s*\(([^–\-)]+)[–-]([^)]+)\)/u;

export function parseSessionText(
  text: string
): { durationSeconds: number; start: string; end: string } | null {
  const match = text.match(SESSION_RE);
  if (!match) return null;
  const [, durationToken, start, end] = match;
  const seconds = parseDurationToSeconds(durationToken.trim());
  if (seconds === null) return null;
  return { durationSeconds: roundDurationSeconds(seconds), start: start.trim(), end: end.trim() };
}
