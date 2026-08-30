import { describe, expect, it } from 'vitest';
import {
  desiredTasksFromEvents,
  isoDateUtc,
  planSync,
  syncWindow,
  type DesiredTask,
  type FeedTaskRow,
} from './calendarSync.js';
import type { IcalEvent } from './ical.js';

const TZ = 'America/El_Salvador';

function ev(over: Partial<IcalEvent> = {}): IcalEvent {
  return {
    uid: 'e1',
    summary: 'Reunión',
    start: new Date('2026-08-28T20:00:00Z'), // 14:00 El Salvador
    end: new Date('2026-08-28T21:00:00Z'),
    location: null,
    ...over,
  };
}

function row(over: Partial<FeedTaskRow> = {}): FeedTaskRow {
  return {
    id: 't1',
    externalUid: 'e1',
    name: 'Reunión',
    date: '2026-08-28',
    externalDate: '2026-08-28',
    notes: '📅 14:00–15:00',
    estimateMin: 60,
    done: false,
    hasSessions: false,
    ...over,
  };
}

describe('desiredTasksFromEvents', () => {
  it('convierte a fecha/hora local, con estimación por duración y nota', () => {
    const [d] = desiredTasksFromEvents([ev({ location: 'Sala 2' })], TZ);
    expect(d).toEqual<DesiredTask>({
      externalUid: 'e1',
      name: 'Reunión',
      date: '2026-08-28',
      estimateMin: 60,
      notes: '📅 14:00–15:00 · Sala 2',
    });
  });

  it('deduplica por uid', () => {
    expect(desiredTasksFromEvents([ev(), ev()], TZ)).toHaveLength(1);
  });
});

describe('planSync', () => {
  it('crea las que no existen', () => {
    const plan = planSync(desiredTasksFromEvents([ev()], TZ), []);
    expect(plan.create).toHaveLength(1);
    expect(plan.update).toHaveLength(0);
  });

  it('actualiza una sin tocar cuando el calendario cambió', () => {
    const desired = desiredTasksFromEvents([ev({ summary: 'Reunión (renombrada)' })], TZ);
    const plan = planSync(desired, [row()]);
    expect(plan.update).toEqual([expect.objectContaining({ id: 't1', name: 'Reunión (renombrada)' })]);
    expect(plan.create).toHaveLength(0);
  });

  it('no toca una sin cambios', () => {
    const plan = planSync(desiredTasksFromEvents([ev()], TZ), [row()]);
    expect(plan.update).toHaveLength(0);
    expect(plan.remove).toHaveLength(0);
  });

  it('respeta una tarea que el usuario movió de día', () => {
    const desired = desiredTasksFromEvents([ev({ summary: 'x' })], TZ);
    const plan = planSync(desired, [row({ date: '2026-08-29', externalDate: '2026-08-28' })]);
    expect(plan.update).toHaveLength(0);
  });

  it('respeta una tarea con tiempo registrado', () => {
    const desired = desiredTasksFromEvents([ev({ summary: 'x' })], TZ);
    const plan = planSync(desired, [row({ hasSessions: true })]);
    expect(plan.update).toHaveLength(0);
  });

  it('borra las que desaparecieron y nadie tocó', () => {
    const plan = planSync([], [row()]);
    expect(plan.remove).toEqual(['t1']);
    expect(plan.orphan).toHaveLength(0);
  });

  it('huerfaniza las que desaparecieron pero tienen historial', () => {
    const plan = planSync([], [row({ hasSessions: true })]);
    expect(plan.orphan).toEqual(['t1']);
    expect(plan.remove).toHaveLength(0);
  });
});

describe('syncWindow', () => {
  it('va de hoy-7 a hoy+28', () => {
    const { start, end } = syncWindow(new Date('2026-08-28T12:00:00Z'));
    expect(isoDateUtc(start)).toBe('2026-08-21');
    expect(isoDateUtc(end)).toBe('2026-09-25');
  });
});
