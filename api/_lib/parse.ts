/** Helpers puros de texto y aritmética de fechas ('YYYY-MM-DD') usados por
 *  el store y por weekDates.ts. Sin dependencias del almacén. */

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

// Ej: "2026.08.17 - 2026.08.21". Tolera `-` o `/` como separador interno y
// guion largo entre las dos fechas (encabezados viejos / con typos).
const WEEK_RANGE_RE =
  /(\d{4})[.\-/](\d{2})[.\-/](\d{2})\s*[-–—]\s*(\d{4})[.\-/](\d{2})[.\-/](\d{2})/;

export function parseWeekRange(headingText: string): { start: string; end: string } | null {
  const match = headingText.match(WEEK_RANGE_RE);
  if (!match) return null;
  const [, y1, m1, d1, y2, m2, d2] = match;
  return { start: `${y1}-${m1}-${d1}`, end: `${y2}-${m2}-${d2}` };
}

/** "YYYY-MM-DD" de "hoy" en una zona horaria dada. */
export function todayDateStringInTz(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Nombre del día de la semana ("lunes", ...) normalizado, sin acentos. */
export function todayWeekdayNameInTz(timeZone: string): string {
  const name = new Intl.DateTimeFormat('es-ES', { timeZone, weekday: 'long' }).format(new Date());
  return normalize(name);
}

/** Suma (o resta, con negativo) días a una fecha "YYYY-MM-DD". En UTC para
 *  no arrastrar corrimientos de zona horaria en la aritmética. */
export function addDaysToDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "2026-08-17" → "2026.08.17". */
export function formatWeekDate(dateStr: string): string {
  return dateStr.replace(/-/g, '.');
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `true` si `s` tiene formato "YYYY-MM" con mes válido. */
export function isValidMonth(s: string): boolean {
  return MONTH_RE.test(s);
}

/** Primer y último día ("YYYY-MM-DD") del mes "YYYY-MM". */
export function monthRange(month: string): { first: string; last: string } {
  const first = `${month}-01`;
  return { first, last: addDaysToDate(addMonths(month, 1) + '-01', -1) };
}

/** Suma (o resta) meses a un "YYYY-MM", ajustando el año. */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}`;
}

export function formatWeekLabel(start: string, end: string): string {
  return `${formatWeekDate(start)} - ${formatWeekDate(end)}`;
}
