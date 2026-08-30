import { describe, expect, it } from 'vitest';
import { baseCanDrop, computeReorderTarget, parseZoneTag, type DragItem } from './dnd';
import type { Task } from '../types';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    name: 'Tarea',
    date: '2026-08-24',
    done: false,
    order: 0,
    file: null,
    priority: null,
    notes: null,
    due: null,
    estimateMinutes: null,
    plannedStart: null,
    plannedMinutes: null,
    tagIds: [],
    source: 'manual',
    createdAt: '2026-08-24T10:00:00.000Z',
    checklist: [],
    sessions: [],
    ...overrides,
  };
}

const session = { id: 's1', taskId: 't1', durationSeconds: 600, start: '09:00', end: '09:10' };

describe('parseZoneTag', () => {
  it('parsea cada formato', () => {
    expect(parseZoneTag('list-end')).toEqual({ kind: 'list-end' });
    expect(parseZoneTag('inbox')).toEqual({ kind: 'inbox' });
    expect(parseZoneTag('day:Lunes')).toEqual({ kind: 'day', day: 'Lunes' });
    expect(parseZoneTag('day:Miércoles')).toEqual({ kind: 'day', day: 'Miércoles' });
    expect(parseZoneTag('row:0')).toEqual({ kind: 'row', index: 0 });
    expect(parseZoneTag('row:12')).toEqual({ kind: 'row', index: 12 });
  });

  it('rechaza valores inválidos', () => {
    expect(parseZoneTag(null)).toBeNull();
    expect(parseZoneTag('')).toBeNull();
    expect(parseZoneTag('day:')).toBeNull();
    expect(parseZoneTag('row:-1')).toBeNull();
    expect(parseZoneTag('row:x')).toBeNull();
    expect(parseZoneTag('otra-cosa')).toBeNull();
  });
});

describe('computeReorderTarget', () => {
  // lista [A,B,C,D]
  it('mover hacia abajo, mitad inferior', () => {
    // A (0) sobre la mitad inferior de C (2) -> [B,C,A,D]
    expect(computeReorderTarget(0, 2, true)).toBe(2);
  });

  it('mover hacia arriba, mitad superior', () => {
    // D (3) sobre la mitad superior de B (1) -> [A,D,B,C]
    expect(computeReorderTarget(3, 1, false)).toBe(1);
  });

  it('soltar sobre la misma fila no cambia nada', () => {
    expect(computeReorderTarget(1, 1, false)).toBe(1);
    expect(computeReorderTarget(1, 1, true)).toBe(1);
  });

  it('al principio de la lista', () => {
    expect(computeReorderTarget(2, 0, false)).toBe(0);
  });
});

describe('baseCanDrop', () => {
  it('una tarea sin sesiones puede ir al inbox', () => {
    const item: DragItem = { kind: 'task', task: task(), index: 0 };
    expect(baseCanDrop(item, { kind: 'inbox' })).toBe(true);
  });

  it('una tarea con tiempo registrado no puede ir al inbox', () => {
    const item: DragItem = { kind: 'task', task: task({ sessions: [session] }), index: 0 };
    expect(baseCanDrop(item, { kind: 'inbox' })).toBe(false);
    expect(baseCanDrop(item, { kind: 'day', day: 'Lunes' })).toBe(true);
  });

  it('una nota del inbox va a un día o a la lista, no al inbox', () => {
    const item: DragItem = { kind: 'inbox', task: task({ date: null }) };
    expect(baseCanDrop(item, { kind: 'day', day: 'Lunes' })).toBe(true);
    expect(baseCanDrop(item, { kind: 'row', index: 0, after: false })).toBe(true);
    expect(baseCanDrop(item, { kind: 'list-end' })).toBe(true);
    expect(baseCanDrop(item, { kind: 'inbox' })).toBe(false);
  });
});
