/**
 * Lógica pura del timeline del día (time-blocking v2, ROADMAP §11 Tier 3):
 * conversión hora↔minuto, la duración por defecto de un bloque, el rango
 * [inicio, fin) de un bloque planeado o de una sesión registrada, y el
 * layout de columnas cuando dos o más bloques se solapan en el tiempo.
 *
 * Todo en "minutos desde la medianoche" (0..1440); el timeline es de un
 * solo día — un bloque o sesión que llega a medianoche se recorta ahí, no
 * sigue al día siguiente.
 */

export const MINUTES_PER_DAY = 1440;
/** Duración de un bloque recién agendado sin estimación. */
export const DEFAULT_BLOCK_MINUTES = 30;
/** Piso al redimensionar o agendar arrastrando. */
export const MIN_BLOCK_MINUTES = 5;
/** Paso de "snap" al arrastrar/redimensionar. */
export const SNAP_MINUTES = 5;

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Minutos (pueden venir fuera de 0..1440, ej. de un arrastre) → "HH:MM", con wrap. */
export function minutesToTime(minutes: number): string {
  const m = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function snapMinutes(minutes: number, step: number = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

/** Recorta un inicio de bloque a un día válido: 0..(1440 - MIN_BLOCK_MINUTES). */
export function clampBlockStart(minutes: number): number {
  return Math.min(Math.max(0, minutes), MINUTES_PER_DAY - MIN_BLOCK_MINUTES);
}

/** Recorta una duración para que quepa entre `start` y la medianoche. */
export function clampBlockDuration(start: number, minutes: number): number {
  return Math.min(Math.max(MIN_BLOCK_MINUTES, minutes), MINUTES_PER_DAY - start);
}

/** Duración del bloque: lo redimensionado a mano > la estimación > el default. */
export function blockDurationMinutes(
  plannedMinutes: number | null,
  estimateMinutes: number | null
): number {
  return plannedMinutes ?? estimateMinutes ?? DEFAULT_BLOCK_MINUTES;
}

export type TimeRange = { start: number; end: number };

/** [inicio, fin) del bloque planeado de una tarea, recortado al final del día. */
export function plannedRange(
  plannedStart: string,
  plannedMinutes: number | null,
  estimateMinutes: number | null
): TimeRange {
  const start = timeToMinutes(plannedStart);
  const duration = blockDurationMinutes(plannedMinutes, estimateMinutes);
  const end = Math.min(MINUTES_PER_DAY, start + duration);
  return { start, end: Math.max(end, start + 1) };
}

/** [inicio, fin) de una sesión registrada, recortado al final del día si
 *  cruza la medianoche (termina al día siguiente). */
export function sessionRange(start: string, end: string): TimeRange {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  return { start: s, end: e <= s ? MINUTES_PER_DAY : Math.max(e, s + 1) };
}

export type ColumnLayout = { col: number; cols: number };

/**
 * Asigna columna(s) a un set de bloques que pueden solaparse en el tiempo,
 * al estilo de un calendario: los que se solapan se reparten el ancho en
 * columnas iguales; los que no se tocan con nadie ocupan el ancho completo.
 * Heurística greedy (no necesariamente óptima en solapamientos parciales
 * encadenados), de sobra para la agenda de un día con pocas tareas.
 */
export function layoutColumns<T extends { id: string } & TimeRange>(
  items: readonly T[]
): Map<string, ColumnLayout> {
  const layout = new Map<string, ColumnLayout>();
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);

  let cluster: T[] = [];
  let clusterEnd = -Infinity;

  function flush() {
    if (cluster.length === 0) return;
    const columnEnds: number[] = [];
    for (const item of cluster) {
      const col = columnEnds.findIndex((end) => end <= item.start);
      if (col === -1) {
        layout.set(item.id, { col: columnEnds.length, cols: 0 });
        columnEnds.push(item.end);
      } else {
        layout.set(item.id, { col, cols: 0 });
        columnEnds[col] = item.end;
      }
    }
    for (const item of cluster) layout.get(item.id)!.cols = columnEnds.length;
    cluster = [];
  }

  for (const item of sorted) {
    if (cluster.length > 0 && item.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();

  return layout;
}
