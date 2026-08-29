// Lógica pura de "¿qué semana y qué día mostrar?", sin nada de Notion.
// Se extrae de getWeekView (notionStore.ts) porque son las heurísticas más
// enredadas del backend y las más fáciles de romper sin darse cuenta —
// acá quedan aisladas y con tests directos (weekModel.test.ts).

import { isDateInRange, normalize } from './parse.js';

export type WeekSource = 'auto-matched' | 'auto-fallback' | 'requested';

export type DateRange = { start: string; end: string };

/** Una semana vista solo como su etiqueta y su rango de fechas (o null si
 *  el encabezado no tiene un rango parseable). Alineada por índice con la
 *  lista real de semanas que maneja el store. */
export type WeekSummary = { label: string; range: DateRange | null };

/** Un rango solo cuenta si es parseable y start <= end (protege contra
 *  encabezados con typos, ej. "2026.08.03 - 2026.03.07"). */
export function hasValidRange(week: WeekSummary): week is WeekSummary & { range: DateRange } {
  return week.range !== null && week.range.start <= week.range.end;
}

/** Índice de la semana cuyo rango contiene `today`, o -1. */
export function findTodayWeekIndex(weeks: WeekSummary[], today: string): number {
  return weeks.findIndex(
    (w) => hasValidRange(w) && isDateInRange(today, w.range.start, w.range.end)
  );
}

/**
 * Elige la semana activa y de dónde salió la decisión:
 * - `requested`: el usuario navegó explícitamente a una semana (por label).
 *   `activeIndex` es -1 si esa semana no existe — el caller responde 404.
 * - `auto-matched`: hoy cae dentro de una semana. No dispara aviso en la UI.
 * - `auto-fallback`: no hay match exacto (ej. fin de semana entre dos
 *   semanas). Se prefiere la semana ya terminada más reciente; si todas las
 *   que tienen rango válido son futuras, la más próxima a empezar; si
 *   ninguna tiene rango parseable, la primera de la lista. Dispara el aviso.
 *
 * `todayWeekIndex` se devuelve para que el caller calcule `isCurrentWeek`
 * sin recalcularlo.
 */
export function selectActiveWeek(
  weeks: WeekSummary[],
  today: string,
  requestedWeek: string | undefined
): { activeIndex: number; weekSource: WeekSource; todayWeekIndex: number } {
  const todayWeekIndex = findTodayWeekIndex(weeks, today);

  if (requestedWeek) {
    return {
      activeIndex: weeks.findIndex((w) => w.label === requestedWeek),
      weekSource: 'requested',
      todayWeekIndex,
    };
  }

  if (todayWeekIndex !== -1) {
    return { activeIndex: todayWeekIndex, weekSource: 'auto-matched', todayWeekIndex };
  }

  const valid = weeks
    .map((w, index) => ({ index, range: w.range }))
    .filter(
      (x): x is { index: number; range: DateRange } =>
        x.range !== null && x.range.start <= x.range.end
    );
  const past = valid.filter((x) => x.range.end < today);
  const future = valid.filter((x) => x.range.start > today);

  let activeIndex: number;
  if (past.length > 0) {
    activeIndex = past.reduce((a, b) => (a.range.end > b.range.end ? a : b)).index;
  } else if (future.length > 0) {
    activeIndex = future.reduce((a, b) => (a.range.start < b.range.start ? a : b)).index;
  } else {
    activeIndex = 0;
  }
  return { activeIndex, weekSource: 'auto-fallback', todayWeekIndex };
}

/**
 * Etiquetas de la semana anterior/siguiente, en orden cronológico por
 * fecha de inicio (no por posición en el documento — la plantilla puede
 * listar las semanas de más nueva a más vieja o al revés). Devuelve null a
 * cada lado que no exista, y ambos null si la semana activa no tiene rango
 * válido (no entra en la navegación).
 */
export function computeWeekNav(
  weeks: WeekSummary[],
  activeIndex: number
): { previousWeekLabel: string | null; nextWeekLabel: string | null } {
  const active = weeks[activeIndex];
  const navigable = weeks
    .filter(hasValidRange)
    .sort((a, b) => (a.range.start < b.range.start ? -1 : a.range.start > b.range.start ? 1 : 0));
  const pos = navigable.findIndex((w) => w === active);
  return {
    previousWeekLabel: pos > 0 ? navigable[pos - 1].label : null,
    nextWeekLabel: pos >= 0 && pos < navigable.length - 1 ? navigable[pos + 1].label : null,
  };
}

/**
 * Elige el día seleccionado dentro de la semana activa. `dayOrder` debe
 * tener al menos un elemento (el caller ya trató el caso de semana sin
 * días). `todayWeekday` se espera ya normalizado (sin acentos, minúsculas),
 * igual que lo devuelve todayWeekdayNameInTz.
 * - `requestedDay`: se busca por nombre normalizado; `dayMatched=false` si
 *   no está (la UI avisa), pero igual se cae al primer día.
 * - semana `requested` sin `requestedDay`: no tiene sentido buscar "hoy" en
 *   otra semana — primer día, `dayMatched=true`.
 * - resto: se busca el día de hoy; `dayMatched=false` si la semana no lo
 *   tiene (ej. hoy es sábado).
 */
export function selectDay(
  dayOrder: string[],
  opts: { requestedDay?: string; weekSource: WeekSource; todayWeekday: string }
): { selectedDay: string; dayMatched: boolean } {
  const { requestedDay, weekSource, todayWeekday } = opts;

  let selectedDay: string | undefined;
  let dayMatched: boolean;
  if (requestedDay) {
    selectedDay = dayOrder.find((d) => normalize(d) === normalize(requestedDay));
    dayMatched = Boolean(selectedDay);
  } else if (weekSource === 'requested') {
    dayMatched = true;
  } else {
    selectedDay = dayOrder.find((d) => normalize(d) === todayWeekday);
    dayMatched = Boolean(selectedDay);
  }

  return { selectedDay: selectedDay ?? dayOrder[0], dayMatched };
}
