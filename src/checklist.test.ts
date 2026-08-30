import { describe, expect, it } from 'vitest';
import type { ChecklistItem } from './types';
import {
  addChecklistItem,
  CHECKLIST_MAX_ITEMS,
  checklistAllDone,
  checklistLabel,
  checklistProgress,
  removeChecklistItem,
  renameChecklistItem,
  toggleChecklistItem,
} from './checklist';

const items = (...spec: [string, boolean][]): ChecklistItem[] =>
  spec.map(([text, done], i) => ({ id: `i${i}`, text, done }));

describe('checklistProgress / checklistLabel', () => {
  it('null y "" sin ítems', () => {
    expect(checklistProgress([])).toBeNull();
    expect(checklistLabel([])).toBeNull();
  });

  it('cuenta hechos vs total', () => {
    const cl = items(['a', true], ['b', false], ['c', true]);
    expect(checklistProgress(cl)).toEqual({ done: 2, total: 3 });
    expect(checklistLabel(cl)).toBe('2/3');
  });
});

describe('checklistAllDone', () => {
  it('false sin ítems, true solo si todos marcados', () => {
    expect(checklistAllDone([])).toBe(false);
    expect(checklistAllDone(items(['a', true], ['b', false]))).toBe(false);
    expect(checklistAllDone(items(['a', true], ['b', true]))).toBe(true);
  });
});

describe('addChecklistItem', () => {
  it('agrega al final con texto recortado', () => {
    const out = addChecklistItem([], '  comprar pan  ');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: 'comprar pan', done: false });
    expect(out[0].id).toBeTruthy();
  });

  it('ignora texto vacío (devuelve la misma referencia)', () => {
    const cl = items(['a', false]);
    expect(addChecklistItem(cl, '   ')).toBe(cl);
  });

  it('respeta el tope de ítems', () => {
    const full = Array.from({ length: CHECKLIST_MAX_ITEMS }, (_, i) => ({
      id: `i${i}`,
      text: `t${i}`,
      done: false,
    }));
    expect(addChecklistItem(full, 'uno más')).toBe(full);
  });
});

describe('toggle / remove / rename', () => {
  it('toggle invierte solo el ítem elegido', () => {
    const cl = items(['a', false], ['b', false]);
    expect(toggleChecklistItem(cl, 'i0').map((i) => i.done)).toEqual([true, false]);
  });

  it('remove saca por id', () => {
    const cl = items(['a', false], ['b', false]);
    expect(removeChecklistItem(cl, 'i0').map((i) => i.text)).toEqual(['b']);
  });

  it('rename actualiza el texto; vacío elimina el ítem', () => {
    const cl = items(['a', false], ['b', false]);
    expect(renameChecklistItem(cl, 'i0', 'A!').map((i) => i.text)).toEqual(['A!', 'b']);
    expect(renameChecklistItem(cl, 'i0', '  ').map((i) => i.text)).toEqual(['b']);
  });
});
