import type { ChecklistItem } from './types';

/** Tope de ítems por tarea (coincide con el del backend). */
export const CHECKLIST_MAX_ITEMS = 50;
export const CHECKLIST_TEXT_MAX = 200;

/** `{ done, total }` para el chip "2/5", o `null` si la tarea no tiene checklist. */
export function checklistProgress(items: ChecklistItem[]): { done: number; total: number } | null {
  if (items.length === 0) return null;
  return { done: items.filter((i) => i.done).length, total: items.length };
}

/** "2/5" o `null`. */
export function checklistLabel(items: ChecklistItem[]): string | null {
  const p = checklistProgress(items);
  return p ? `${p.done}/${p.total}` : null;
}

/** true si hay ítems y todos están marcados. */
export function checklistAllDone(items: ChecklistItem[]): boolean {
  return items.length > 0 && items.every((i) => i.done);
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Agrega un ítem al final. Recorta el texto y respeta el tope; devuelve la
 *  lista igual si el texto queda vacío o ya se llegó al máximo. */
export function addChecklistItem(items: ChecklistItem[], text: string): ChecklistItem[] {
  const trimmed = text.trim().slice(0, CHECKLIST_TEXT_MAX);
  if (!trimmed || items.length >= CHECKLIST_MAX_ITEMS) return items;
  return [...items, { id: newId(), text: trimmed, done: false }];
}

export function toggleChecklistItem(items: ChecklistItem[], id: string): ChecklistItem[] {
  return items.map((i) => (i.id === id ? { ...i, done: !i.done } : i));
}

export function removeChecklistItem(items: ChecklistItem[], id: string): ChecklistItem[] {
  return items.filter((i) => i.id !== id);
}

export function renameChecklistItem(items: ChecklistItem[], id: string, text: string): ChecklistItem[] {
  const trimmed = text.trim().slice(0, CHECKLIST_TEXT_MAX);
  if (!trimmed) return removeChecklistItem(items, id);
  return items.map((i) => (i.id === id ? { ...i, text: trimmed } : i));
}
