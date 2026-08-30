import type { Task } from '../types';

/** Lo que se está arrastrando. */
export type DragItem =
  | { kind: 'task'; task: Task; index: number }
  | { kind: 'inbox'; task: Task };

/** El atributo `data-drag-zone` ya parseado, sin la parte que depende del
 *  puntero (el `after` de una fila se calcula con el rect en vivo). */
export type ZoneTag =
  | { kind: 'row'; index: number }
  | { kind: 'list-end' }
  | { kind: 'day'; day: string }
  | { kind: 'inbox' };

/** Zona de destino concreta bajo el puntero. */
export type DropZone =
  | { kind: 'row'; index: number; after: boolean }
  | { kind: 'list-end' }
  | { kind: 'day'; day: string }
  | { kind: 'inbox' };

/**
 * Parsea el valor de `data-drag-zone`. Formatos:
 *   "row:3"  · fila 3 de la lista del día
 *   "list-end"  · el hueco al final de la lista
 *   "day:Lunes"  · la pestaña de un día
 *   "inbox"  · el cajón de tareas sin fecha
 * Devuelve null si el valor no matchea ninguno.
 */
export function parseZoneTag(raw: string | null | undefined): ZoneTag | null {
  if (!raw) return null;
  if (raw === 'list-end') return { kind: 'list-end' };
  if (raw === 'inbox') return { kind: 'inbox' };
  if (raw.startsWith('day:')) {
    const day = raw.slice(4);
    return day ? { kind: 'day', day } : null;
  }
  if (raw.startsWith('row:')) {
    const index = Number(raw.slice(4));
    return Number.isInteger(index) && index >= 0 ? { kind: 'row', index } : null;
  }
  return null;
}

/**
 * Índice destino —en la lista SIN la tarea que se mueve— para soltar la fila
 * `fromIndex` sobre `hoveredIndex`, en su mitad superior (`after` false) o
 * inferior (`after` true). Encaja con `computeAfterId` / `handleReorderTask`.
 */
export function computeReorderTarget(fromIndex: number, hoveredIndex: number, after: boolean): number {
  const slot = after ? hoveredIndex + 1 : hoveredIndex;
  return fromIndex < slot ? slot - 1 : slot;
}

/**
 * Regla base de compatibilidad item ↔ zona, sin contexto (no sabe cuál es el
 * día actual; eso lo filtra quien la envuelve). Una tarea con tiempo
 * registrado no puede volver al inbox; una nota del inbox no se suelta en el
 * propio inbox.
 */
export function baseCanDrop(item: DragItem, zone: DropZone): boolean {
  if (item.kind === 'task') {
    if (zone.kind === 'inbox') return item.task.sessions.length === 0;
    return true;
  }
  return zone.kind === 'day' || zone.kind === 'row' || zone.kind === 'list-end';
}
