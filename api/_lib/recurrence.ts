/**
 * Lógica pura de recurrencia: dada una regla y una fecha, decidir si la regla
 * "cae" ese día. El SQL (leer reglas, materializar tareas) vive en
 * sqliteStore.ts; acá solo el calendario. Testeado en recurrence.test.ts.
 *
 * - freq 'weekly'  → la tarea cae los días de semana marcados en `weekdays`
 *   (CSV 1=Lun..7=Dom), como siempre.
 * - freq 'monthly' → cae los días del mes de `monthdays` (CSV 1..31); el token
 *   especial `-1` significa "el último día del mes" (28/29/30/31 según toque).
 */
import { addDaysToDate } from './parse.js';

export type RecurringFreq = 'weekly' | 'monthly';

export type RecurrenceSpec = {
  freq: RecurringFreq;
  /** CSV 1(Lun)..7(Dom); solo se usa con freq 'weekly'. */
  weekdays: string;
  /** CSV de días del mes 1..31, más `-1` = último día; solo con freq 'monthly'. */
  monthdays: string;
};

export const WEEKDAYS_RE = /^[1-7](,[1-7])*$/;

/** Día ISO de la semana de una fecha 'YYYY-MM-DD': 1=Lun..7=Dom. */
export function isoWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Dom..6=Sáb
  return ((dow + 6) % 7) + 1;
}

/** true si `dateStr` es el último día de su mes. */
export function isLastDayOfMonth(dateStr: string): boolean {
  return addDaysToDate(dateStr, 1).slice(5, 7) !== dateStr.slice(5, 7);
}

/**
 * Parsea `monthdays` a una lista ordenada y sin repetidos. Devuelve `[]` si
 * algún token no es un entero en [1,31] o `-1` (así el caller la trata como
 * inválida).
 */
export function parseMonthdays(csv: string): number[] {
  if (typeof csv !== 'string' || csv.trim() === '') return [];
  const out = new Set<number>();
  for (const part of csv.split(',')) {
    const n = Number(part.trim());
    if (!Number.isInteger(n)) return [];
    if (n === -1 || (n >= 1 && n <= 31)) out.add(n);
    else return [];
  }
  return [...out].sort((a, b) => a - b);
}

/** CSV canónico (ordenado, sin repetidos) de una lista de días del mes. */
export function serializeMonthdays(days: number[]): string {
  return [...new Set(days)].sort((a, b) => a - b).join(',');
}

export function isValidWeekdays(csv: string): boolean {
  return typeof csv === 'string' && WEEKDAYS_RE.test(csv);
}

export function isValidMonthdays(csv: string): boolean {
  return parseMonthdays(csv).length > 0;
}

/** ¿La regla `spec` cae el día `dateStr` ('YYYY-MM-DD')? */
export function ruleFiresOn(spec: RecurrenceSpec, dateStr: string): boolean {
  if (spec.freq === 'monthly') {
    const days = parseMonthdays(spec.monthdays);
    if (days.length === 0) return false;
    const dom = Number(dateStr.slice(8, 10));
    if (days.includes(dom)) return true;
    return days.includes(-1) && isLastDayOfMonth(dateStr);
  }
  return spec.weekdays.split(',').includes(String(isoWeekday(dateStr)));
}

/** Resumen corto para la UI: "Lun–Vie", "L X V", "día 1 y 15", "último día". */
export function recurrenceSummary(spec: RecurrenceSpec): string {
  if (spec.freq === 'monthly') {
    const days = parseMonthdays(spec.monthdays);
    if (days.length === 0) return 'sin días';
    const parts = days.map((d) => (d === -1 ? 'último día' : `día ${d}`));
    return parts.join(', ');
  }
  const set = new Set(spec.weekdays.split(','));
  if (['1', '2', '3', '4', '5'].every((d) => set.has(d)) && set.size === 5) return 'Lun–Vie';
  const labels: Record<string, string> = { '1': 'L', '2': 'M', '3': 'X', '4': 'J', '5': 'V', '6': 'S', '7': 'D' };
  return ['1', '2', '3', '4', '5', '6', '7']
    .filter((n) => set.has(n))
    .map((n) => labels[n])
    .join(' ');
}
