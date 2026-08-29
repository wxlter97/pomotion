/**
 * Agregaciones puras para el panel de analítica. Operan sobre listas
 * planas (no tocan la DB) → testeadas en analytics.test.ts.
 */
import { addDaysToDate } from './parse.js';
import { mondayOf } from './weekDates.js';

export type AnalyticsSession = { date: string; start: string; durationSec: number };
export type AnalyticsTask = { date: string; done: boolean };

export type Analytics = {
  weeks: number;
  /** Lunes de la primera semana de la ventana, 'YYYY-MM-DD'. */
  startDate: string;
  /** Hoy, 'YYYY-MM-DD'. */
  endDate: string;
  totalSeconds: number;
  /** Días distintos con al menos una sesión en la ventana. */
  activeDays: number;
  /** 7 buckets, Lunes → Domingo. */
  byWeekday: { label: string; totalSeconds: number }[];
  /** 24 buckets, hora 0..23. */
  byHour: { hour: number; totalSeconds: number }[];
  /** Un bucket por semana de la ventana, ascendente. */
  byWeek: { weekStart: string; label: string; totalSeconds: number }[];
  completion: { total: number; done: number };
  streak: { current: number; longest: number };
};

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTH_ABBR = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

/** 0=Lunes .. 6=Domingo para 'YYYY-MM-DD' (sin corrimiento de zona). */
export function weekdayMon0(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Dom
  return (dow + 6) % 7;
}

function isWeekend(dateStr: string): boolean {
  return weekdayMon0(dateStr) >= 5;
}

/** "24 ago" a partir de 'YYYY-MM-DD'. */
function shortLabel(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${Number(d)} ${MONTH_ABBR[Number(m) - 1]}`;
}

function hourOf(start: string): number | null {
  const h = Number(start.slice(0, 2));
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : null;
}

/** Racha actual y más larga de días activos en [startDate, endDate].
 *  Un fin de semana sin actividad no corta la racha (se saltea). */
export function computeStreak(
  activeDates: Set<string>,
  startDate: string,
  endDate: string
): { current: number; longest: number } {
  // Actual: hacia atrás desde hoy. Si hoy todavía no tiene sesión, se
  // arranca desde ayer (gracia), no se cuenta como cortada.
  let current = 0;
  let cursor = activeDates.has(endDate) ? endDate : addDaysToDate(endDate, -1);
  while (cursor >= startDate) {
    if (activeDates.has(cursor)) {
      current++;
      cursor = addDaysToDate(cursor, -1);
    } else if (isWeekend(cursor)) {
      cursor = addDaysToDate(cursor, -1);
    } else {
      break;
    }
  }

  // Más larga: recorrido ascendente por toda la ventana.
  let longest = 0;
  let run = 0;
  for (let d = startDate; d <= endDate; d = addDaysToDate(d, 1)) {
    if (activeDates.has(d)) {
      run++;
      if (run > longest) longest = run;
    } else if (!isWeekend(d)) {
      run = 0;
    }
  }

  return { current, longest };
}

export function computeAnalytics(
  sessions: AnalyticsSession[],
  tasks: AnalyticsTask[],
  opts: { weeks: number; startMonday: string; endDate: string }
): Analytics {
  const { weeks, startMonday, endDate } = opts;

  const byWeekday = WEEKDAY_LABELS.map((label) => ({ label, totalSeconds: 0 }));
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, totalSeconds: 0 }));

  const weekStarts = Array.from({ length: weeks }, (_, i) => addDaysToDate(startMonday, i * 7));
  const weekIndex = new Map(weekStarts.map((ws, i) => [ws, i]));
  const byWeek = weekStarts.map((weekStart) => ({
    weekStart,
    label: shortLabel(weekStart),
    totalSeconds: 0,
  }));

  const activeDates = new Set<string>();
  let totalSeconds = 0;

  for (const s of sessions) {
    if (s.date < startMonday || s.date > endDate) continue;
    totalSeconds += s.durationSec;
    activeDates.add(s.date);
    byWeekday[weekdayMon0(s.date)].totalSeconds += s.durationSec;
    const h = hourOf(s.start);
    if (h != null) byHour[h].totalSeconds += s.durationSec;
    const wi = weekIndex.get(mondayOf(s.date));
    if (wi != null) byWeek[wi].totalSeconds += s.durationSec;
  }

  let total = 0;
  let done = 0;
  for (const t of tasks) {
    if (t.date < startMonday || t.date > endDate) continue;
    total++;
    if (t.done) done++;
  }

  return {
    weeks,
    startDate: startMonday,
    endDate,
    totalSeconds,
    activeDays: activeDates.size,
    byWeekday,
    byHour,
    byWeek,
    completion: { total, done },
    streak: computeStreak(activeDates, startMonday, endDate),
  };
}
