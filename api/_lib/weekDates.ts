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
export const WEEKEND_NAMES = ['Sábado', 'Domingo'] as const;
export const ALL_DAY_NAMES = [...WEEKDAY_NAMES, ...WEEKEND_NAMES] as const;

/** Nombres de día visibles según el toggle "fin de semana opcional" (cliente).
 *  El identificador de semana (la etiqueta) sigue siendo siempre Lun–Vie. */
export function visibleDayNames(includeWeekend: boolean): readonly string[] {
  return includeWeekend ? ALL_DAY_NAMES : WEEKDAY_NAMES;
}

function utcDay(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Dom..6=Sáb
}

/** Lunes ('YYYY-MM-DD') de la semana que contiene `dateStr`. */
export function mondayOf(dateStr: string): string {
  const dow = utcDay(dateStr);
  return addDaysToDate(dateStr, dow === 0 ? -6 : 1 - dow);
}

/** Las fechas de la semana a partir del lunes dado: 5 (Lun–Vie) o, con
 *  `includeWeekend`, 7 (Lun–Dom). */
export function weekDates(mondayStr: string, includeWeekend = false): string[] {
  const n = includeWeekend ? 7 : 5;
  return Array.from({ length: n }, (_, i) => addDaysToDate(mondayStr, i));
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

/** Índice de una etiqueta de día dentro de la semana visible (0..4, o 0..6
 *  con `includeWeekend`), o null si no es un día de esa lista. */
export function weekdayIndex(dayLabel: string, includeWeekend = false): number | null {
  const names = visibleDayNames(includeWeekend);
  const i = names.findIndex((d) => normalize(d) === normalize(dayLabel));
  return i === -1 ? null : i;
}

/** Etiqueta de día laboral de una fecha 'YYYY-MM-DD', o null si cae en fin de semana. */
export function weekdayNameOf(dateStr: string): string | null {
  const dow = utcDay(dateStr); // 1=Lun..5=Vie
  return dow >= 1 && dow <= 5 ? WEEKDAY_NAMES[dow - 1] : null;
}

/** true si la fecha 'YYYY-MM-DD' cae en sábado o domingo. */
export function isWeekend(dateStr: string): boolean {
  const dow = utcDay(dateStr);
  return dow === 0 || dow === 6;
}

/** `dateStr` tal cual si `includeWeekend`; si no, el mismo día cuando es
 *  laboral y el lunes siguiente cuando cae en fin de semana. */
export function toWeekday(dateStr: string, includeWeekend = false): string {
  if (includeWeekend) return dateStr;
  let d = dateStr;
  while (isWeekend(d)) d = addDaysToDate(d, 1);
  return d;
}

/**
 * Día seleccionado dentro de la semana visible: el pedido (si está en la
 * lista visible), o "hoy" si es la semana actual y hoy es un día visible, o
 * Lunes. Siempre devuelve una etiqueta de `visibleDayNames(includeWeekend)`.
 */
export function selectDay(opts: {
  requestedDay?: string;
  isCurrentWeek: boolean;
  timeZone: string;
  includeWeekend?: boolean;
}): string {
  const { requestedDay, isCurrentWeek, timeZone } = opts;
  const names = visibleDayNames(opts.includeWeekend ?? false);
  if (requestedDay) {
    const match = names.find((d) => normalize(d) === normalize(requestedDay));
    if (match) return match;
  }
  if (isCurrentWeek) {
    const today = todayWeekdayNameInTz(timeZone);
    const match = names.find((d) => normalize(d) === today);
    if (match) return match;
  }
  return WEEKDAY_NAMES[0];
}
