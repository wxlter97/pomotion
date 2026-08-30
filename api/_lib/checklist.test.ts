import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_MAX_ITEMS,
  checklistProgress,
  normalizeChecklistInput,
  parseChecklist,
  serializeChecklist,
} from './checklist.js';

let n = 0;
const genId = () => `id-${++n}`;

describe('parseChecklist', () => {
  it('devuelve [] para null / vacío / JSON corrupto / no-array', () => {
    expect(parseChecklist(null)).toEqual([]);
    expect(parseChecklist('')).toEqual([]);
    expect(parseChecklist('{no json')).toEqual([]);
    expect(parseChecklist('{"a":1}')).toEqual([]);
  });

  it('saneia ítems: recorta texto, descarta los vacíos, done es estricto', () => {
    const raw = JSON.stringify([
      { id: 'a', text: '  hacer café  ', done: true },
      { id: 'b', text: 'y beberlo' },
      { id: 'c', text: '   ' },
      { text: 'sin id', done: 'sí' },
    ]);
    expect(parseChecklist(raw)).toEqual([
      { id: 'a', text: 'hacer café', done: true },
      { id: 'b', text: 'y beberlo', done: false },
      { id: 'c2', text: 'sin id', done: false },
    ]);
  });

  it('corta en el tope de ítems', () => {
    const raw = JSON.stringify(
      Array.from({ length: CHECKLIST_MAX_ITEMS + 10 }, (_, i) => ({ id: `x${i}`, text: `t${i}` }))
    );
    expect(parseChecklist(raw)).toHaveLength(CHECKLIST_MAX_ITEMS);
  });
});

describe('serializeChecklist', () => {
  it('lista vacía → null; con ítems → JSON', () => {
    expect(serializeChecklist([])).toBeNull();
    expect(serializeChecklist([{ id: 'a', text: 't', done: false }])).toBe(
      '[{"id":"a","text":"t","done":false}]'
    );
  });

  it('round-trip con parseChecklist', () => {
    const items = [
      { id: 'a', text: 'uno', done: true },
      { id: 'b', text: 'dos', done: false },
    ];
    expect(parseChecklist(serializeChecklist(items))).toEqual(items);
  });
});

describe('normalizeChecklistInput', () => {
  it('lanza si no es lista o si un ítem no es objeto', () => {
    expect(() => normalizeChecklistInput('x', genId)).toThrow(/lista/);
    expect(() => normalizeChecklistInput([1], genId)).toThrow(/objeto/);
  });

  it('lanza si text no es string', () => {
    expect(() => normalizeChecklistInput([{ text: 5 }], genId)).toThrow(/texto/);
  });

  it('descarta ítems sin texto, genera ids faltantes y desduplica', () => {
    n = 0;
    const out = normalizeChecklistInput(
      [
        { id: 'dup', text: 'a' },
        { id: 'dup', text: 'b' },
        { text: '   ' },
        { text: 'c', done: true },
      ],
      genId
    );
    expect(out).toEqual([
      { id: 'dup', text: 'a', done: false },
      { id: 'id-1', text: 'b', done: false },
      { id: 'id-2', text: 'c', done: true },
    ]);
  });
});

describe('checklistProgress', () => {
  it('null sin ítems, {done,total} con ítems', () => {
    expect(checklistProgress([])).toBeNull();
    expect(
      checklistProgress([
        { id: 'a', text: 'x', done: true },
        { id: 'b', text: 'y', done: false },
        { id: 'c', text: 'z', done: true },
      ])
    ).toEqual({ done: 2, total: 3 });
  });
});
