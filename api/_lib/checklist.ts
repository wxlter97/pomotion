/**
 * Subtareas / checklist de una tarea (ROADMAP §11 Tier 2).
 *
 * Los ítems se guardan como JSON en la columna `tasks.checklist` (TEXT; NULL =
 * sin checklist). Este módulo es puro: parseo tolerante de lo que hay en la DB
 * y validación de lo que manda el cliente. El SQL vive en sqliteStore.ts.
 */
import { BadRequestError } from './errors.js';

export type ChecklistItem = { id: string; text: string; done: boolean };

export const CHECKLIST_MAX_ITEMS = 50;
export const CHECKLIST_TEXT_MAX = 200;

function coerceItem(raw: unknown, fallbackId: string): ChecklistItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const text = typeof o.text === 'string' ? o.text.trim().slice(0, CHECKLIST_TEXT_MAX) : '';
  if (!text) return null;
  const id = typeof o.id === 'string' && o.id.length > 0 ? o.id : fallbackId;
  return { id, text, done: o.done === true };
}

/**
 * Lee la columna `checklist` (TEXT JSON o NULL) → lista saneada. Nunca lanza:
 * datos corruptos devuelven `[]`. Los ítems sin `id` usable reciben uno
 * derivado del índice (solo pasa con filas manipuladas a mano).
 */
export function parseChecklist(raw: unknown): ChecklistItem[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ChecklistItem[] = [];
  for (const el of parsed) {
    const item = coerceItem(el, `c${out.length}`);
    if (item) out.push(item);
    if (out.length >= CHECKLIST_MAX_ITEMS) break;
  }
  return out;
}

/** Lista → TEXT para guardar. Lista vacía → `null` (limpia la columna). */
export function serializeChecklist(items: ChecklistItem[]): string | null {
  return items.length === 0 ? null : JSON.stringify(items);
}

/**
 * Valida y sanea lo que manda el cliente en `checklist`. Lanza
 * `BadRequestError` si no es una lista o si un ítem tiene un `text` no-string;
 * los ítems con texto vacío tras el trim se descartan en silencio. `genId`
 * genera ids para los ítems nuevos (y para desduplicar).
 */
export function normalizeChecklistInput(input: unknown, genId: () => string): ChecklistItem[] {
  if (!Array.isArray(input)) {
    throw new BadRequestError('invalid_checklist', 'checklist debe ser una lista');
  }
  const out: ChecklistItem[] = [];
  const seen = new Set<string>();
  for (const el of input) {
    if (!el || typeof el !== 'object') {
      throw new BadRequestError('invalid_checklist', 'Cada ítem del checklist debe ser un objeto');
    }
    const o = el as Record<string, unknown>;
    if (o.text !== undefined && typeof o.text !== 'string') {
      throw new BadRequestError('invalid_checklist', 'El texto de un ítem debe ser texto');
    }
    const text = typeof o.text === 'string' ? o.text.trim().slice(0, CHECKLIST_TEXT_MAX) : '';
    if (!text) continue;
    let id = typeof o.id === 'string' && o.id.length > 0 ? o.id : genId();
    if (seen.has(id)) id = genId();
    seen.add(id);
    out.push({ id, text, done: o.done === true });
    if (out.length >= CHECKLIST_MAX_ITEMS) break;
  }
  return out;
}

/** `{ done, total }` para el chip "2/5", o `null` si no hay ítems. */
export function checklistProgress(items: ChecklistItem[]): { done: number; total: number } | null {
  if (items.length === 0) return null;
  return { done: items.filter((i) => i.done).length, total: items.length };
}
