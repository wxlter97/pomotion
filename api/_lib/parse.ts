import type { NotionRichText } from './notionClient.js';

export function plainText(richText: NotionRichText[] | undefined): string {
  if (!richText) return '';
  return richText.map((rt) => rt.plain_text ?? '').join('').trim();
}

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

// Ej: "2026.08.17 - 2026.08.21"
const WEEK_RANGE_RE = /(\d{4})\.(\d{2})\.(\d{2})\s*-\s*(\d{4})\.(\d{2})\.(\d{2})/;

export function parseWeekRange(headingText: string): { start: string; end: string } | null {
  const match = headingText.match(WEEK_RANGE_RE);
  if (!match) return null;
  const [, y1, m1, d1, y2, m2, d2] = match;
  return { start: `${y1}-${m1}-${d1}`, end: `${y2}-${m2}-${d2}` };
}

export function isDateInRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

/** ¿Se solapan dos rangos de fechas "YYYY-MM-DD" (inclusivo en ambos extremos)? */
export function dateRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
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

/** Nombre del día de la semana ("lunes", "martes", ...) normalizado, sin acentos. */
export function todayWeekdayNameInTz(timeZone: string): string {
  const name = new Intl.DateTimeFormat('es-ES', { timeZone, weekday: 'long' }).format(new Date());
  return normalize(name);
}

/** Suma (o resta, con negativo) días a una fecha "YYYY-MM-DD". En UTC para no
 *  arrastrar corrimientos de zona horaria en la aritmética de fechas. */
export function addDaysToDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Día de la semana de una fecha "YYYY-MM-DD" (0=domingo..6=sábado). */
function weekdayOfDate(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** El lunes siguiente (estrictamente posterior) a una fecha "YYYY-MM-DD". */
export function nextMondayAfter(dateStr: string): string {
  let candidate = addDaysToDate(dateStr, 1);
  while (weekdayOfDate(candidate) !== 1) candidate = addDaysToDate(candidate, 1);
  return candidate;
}

/** "2026-08-17" → "2026.08.17", el formato de encabezado de semana ya usado. */
export function formatWeekDate(dateStr: string): string {
  return dateStr.replace(/-/g, '.');
}

export function formatWeekLabel(start: string, end: string): string {
  return `${formatWeekDate(start)} - ${formatWeekDate(end)}`;
}

/**
 * Próxima semana laboral (lunes-viernes) sugerida: el lunes siguiente a la
 * fecha más tardía entre "hoy" y el fin de la última semana existente (así
 * nunca sugiere una semana ya pasada si hace tiempo no se agrega una).
 */
export function computeNextWeekRange(
  existingEndDates: string[],
  todayStr: string
): { start: string; end: string } {
  const latestEnd = existingEndDates.reduce((max, d) => (d > max ? d : max), todayStr);
  const start = nextMondayAfter(latestEnd);
  const end = addDaysToDate(start, 4);
  return { start, end };
}

// Acepta tanto un ID crudo (con o sin guiones) como una URL de Notion que lo contenga.
export const UUID_RE = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i;

export function extractNotionPageId(text: string): string | null {
  const match = text.match(UUID_RE);
  if (!match) return null;
  const raw = match[0].replace(/-/g, '').toLowerCase();
  if (raw.length !== 32) return null;
  return [raw.slice(0, 8), raw.slice(8, 12), raw.slice(12, 16), raw.slice(16, 20), raw.slice(20)].join(
    '-'
  );
}

// URL genérica (Notion usa varios dominios según el cliente: notion.so,
// app.notion.com, etc. — no vale la pena listarlos, cualquier URL en este
// bloque es la referencia a la página, nunca parte de la etiqueta).
const URL_RE = /https?:\/\/\S+/gi;

/**
 * Quita la URL/ID de Notion de un bloque para quedarse solo con la
 * etiqueta que el usuario escribió junto al link (ej. "Trabajo: <link>"
 * → "Trabajo"). Usado para armar la lista de archivos a partir de la
 * página raíz — ver resolveFiles() en notionPage.ts.
 */
export function stripNotionReference(text: string): string {
  return text
    .replace(URL_RE, '')
    .replace(UUID_RE, '')
    .trim()
    .replace(/[-:|•]+$/, '')
    .trim();
}
