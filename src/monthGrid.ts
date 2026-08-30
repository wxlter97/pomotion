import { monthName, type Lang } from './i18n';

/**
 * Helpers puros para la vista mensual: armado de la grilla del calendario
 * (semanas de lunes a domingo) y traducción de una fecha al par
 * (etiqueta de semana, etiqueta de día) que espera `refresh()` / `getTasks()`.
 *
 * Aritmética en UTC para no arrastrar corrimientos de zona horaria — una
 * grilla de calendario es puro calendario, "hoy" llega resuelto del server.
 * Los nombres de día que devuelve `weekTargetForDate` van al server, así que
 * quedan en español canónico; lo que se muestra lo traduce el componente.
 */

const WEEKDAY_LABELS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseYmd(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Índice 0 (lunes) … 6 (domingo) de una fecha "YYYY-MM-DD". */
export function mondayIndex(dateStr: string): number {
  return (parseYmd(dateStr).getUTCDay() + 6) % 7;
}

/** Lunes ("YYYY-MM-DD") de la semana que contiene `dateStr`. */
export function mondayOf(dateStr: string): string {
  const d = parseYmd(dateStr);
  d.setUTCDate(d.getUTCDate() - mondayIndex(dateStr));
  return ymd(d);
}

/** `true` si la fecha cae sábado o domingo (fuera de la vista Lun–Vie). */
export function isWeekend(dateStr: string): boolean {
  return mondayIndex(dateStr) >= 5;
}

/**
 * Semanas del mes "YYYY-MM" como grilla: cada semana son 7 celdas
 * (lunes→domingo), `null` para el relleno de los bordes y "YYYY-MM-DD"
 * para los días del mes.
 */
export function monthGrid(month: string): (string | null)[][] {
  const first = `${month}-01`;
  const startPad = mondayIndex(first);
  const daysInMonth = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)
  ).getUTCDate();

  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(`${month}-${String(day).padStart(2, '0')}`);
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** "Agosto 2026" a partir de "YYYY-MM". */
export function monthTitle(month: string, lang: Lang = 'es'): string {
  const [y, m] = month.split('-').map(Number);
  return `${monthName(m - 1, lang, true)} ${y}`;
}

/**
 * Par (etiqueta de semana, etiqueta de día) para navegar la vista semanal a
 * `dateStr`. Los fines de semana no existen en la vista Lun–Vie → se cae al
 * lunes de esa misma semana.
 */
export function weekTargetForDate(dateStr: string): { week: string; day: string } {
  const monday = mondayOf(dateStr);
  const friday = ymd(
    new Date(parseYmd(monday).getTime() + 4 * 86400000)
  );
  const week = `${monday.replace(/-/g, '.')} - ${friday.replace(/-/g, '.')}`;
  const idx = mondayIndex(dateStr);
  const day = idx >= 5 ? WEEKDAY_LABELS[0] : WEEKDAY_LABELS[idx];
  return { week, day };
}
