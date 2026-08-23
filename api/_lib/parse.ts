import type { NotionRichText } from './notion.js';

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

// Bloques de sesión escritos por la app: "⏱ 25m (10:15–10:40)"
const SESSION_RE = /⏱\s*(\d+)\s*m\s*\(([^–\-)]+)[–-]([^)]+)\)/u;

export function parseSessionText(
  text: string
): { durationMinutes: number; start: string; end: string } | null {
  const match = text.match(SESSION_RE);
  if (!match) return null;
  const [, minutes, start, end] = match;
  return { durationMinutes: Number(minutes), start: start.trim(), end: end.trim() };
}

// Acepta tanto un ID crudo (con o sin guiones) como una URL de Notion que lo contenga.
const UUID_RE = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i;

export function extractNotionPageId(text: string): string | null {
  const match = text.match(UUID_RE);
  if (!match) return null;
  const raw = match[0].replace(/-/g, '').toLowerCase();
  if (raw.length !== 32) return null;
  return [raw.slice(0, 8), raw.slice(8, 12), raw.slice(12, 16), raw.slice(16, 20), raw.slice(20)].join(
    '-'
  );
}
