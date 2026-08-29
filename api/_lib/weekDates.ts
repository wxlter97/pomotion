/**
 * Aritmética de semana/día basada en fechas reales (cada tarea lleva su
 * `date`). Reemplaza a las heurísticas de `weekModel.ts` (que inferían "qué
 * semana existe" del documento de Notion). Puro, testeado en weekDates.test.ts.
 */
import {
  addDaysToDate,
  formatWeekLabel,
  normalize,
  parseWeekRange,
  todayDateStringInTz,
  todayWeekdayNameInTz,
} from './parse.js';

export const WEEKDAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'] as const;

function utcDay(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Dom..6=Sáb
}

/** Lunes ('YYYY-MM-DD') de la semana que contiene `dateStr`. */
export function mondayOf(dateStr: string): string {
  const dow = utcDay(dateStr);
  return addDaysToDate(dateStr, dow === 0 ? -6 : 1 - dow);
}

/** Las 5 fechas Lun–Vie a partir del lunes dado. */
export function weekDates(mondayStr: string): string[] {
  return [0, 1, 2, 3, 4].map((n) => addDaysToDate(mondayStr, n));
}

/** Etiqueta "2026.08.24 - 2026.08.28" de la semana del lunes dado. */
export function weekLabelOf(mondayStr: string): string {
  return formatWeekLabel(mondayStr, addDaysToDate(mondayStr, 4));
}

/** El lunes de la semana pedida: del label si es parseable, si no el de hoy. */
export function resolveWeekStart(requestedWeek: string | undefined, timeZone: string): string {
  if (requestedWeek) {
    const range = parseWeekRange(requestedWeek);
    if (range) return mondayOf(range.start);
  }
  return mondayOf(todayDateStringInTz(timeZone));
}

/** Índice 0..4 de una etiqueta de día laboral, o null. */
export function weekdayIndex(dayLabel: string): number | null {
  const i = WEEKDAY_NAMES.findIndex((d) => normalize(d) === normalize(dayLabel));
  return i === -1 ? null : i;
}

/** Etiqueta de día laboral de una fecha 'YYYY-MM-DD', o null si cae en fin de semana. */
export function weekdayNameOf(dateStr: string): string | null {
  const dow = utcDay(dateStr); // 1=Lun..5=Vie
  return dow >= 1 && dow <= 5 ? WEEKDAY_NAMES[dow - 1] : null;
}

/**
 * Día seleccionado dentro de la semana visible: el pedido (si es un día
 * laboral válido), o "hoy" si es la semana actual y hoy es día laboral, o
 * Lunes. Siempre devuelve una etiqueta de WEEKDAY_NAMES.
 */
export function selectDay(opts: {
  requestedDay?: string;
  isCurrentWeek: boolean;
  timeZone: string;
}): string {
  const { requestedDay, isCurrentWeek, timeZone } = opts;
  if (requestedDay) {
    const match = WEEKDAY_NAMES.find((d) => normalize(d) === normalize(requestedDay));
    if (match) return match;
  }
  if (isCurrentWeek) {
    const today = todayWeekdayNameInTz(timeZone);
    const match = WEEKDAY_NAMES.find((d) => normalize(d) === today);
    if (match) return match;
  }
  return WEEKDAY_NAMES[0];
}
