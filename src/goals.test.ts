import { describe, expect, it } from 'vitest';
import { goalLabel, goalStatus } from './goals';
import type { GoalProgress } from './types';

function make(over: Partial<GoalProgress>): GoalProgress {
  return {
    id: 'g',
    tagId: null,
    file: null,
    targetMinutes: 1200, // 20h
    tagName: null,
    month: '2026-08',
    loggedSeconds: 0,
    dayOfMonth: 15,
    daysInMonth: 30,
    ...over,
  };
}

describe('goalStatus', () => {
  it('calcula progreso y ritmo esperado', () => {
    const s = goalStatus(make({ loggedSeconds: 10 * 3600, dayOfMonth: 15, daysInMonth: 30 }));
    expect(s.targetSeconds).toBe(20 * 3600);
    expect(s.progressPct).toBe(50);
    expect(s.expectedSeconds).toBe(10 * 3600); // mitad del mes → mitad del objetivo
    expect(s.state).toBe('on-track');
    expect(s.remainingSeconds).toBe(10 * 3600);
  });

  it('behind cuando va por debajo del ritmo', () => {
    const s = goalStatus(make({ loggedSeconds: 4 * 3600, dayOfMonth: 15, daysInMonth: 30 }));
    expect(s.state).toBe('behind');
    expect(s.paceDeltaSeconds).toBe(-6 * 3600);
  });

  it('ahead cuando va por encima', () => {
    const s = goalStatus(make({ loggedSeconds: 16 * 3600, dayOfMonth: 15, daysInMonth: 30 }));
    expect(s.state).toBe('ahead');
  });

  it('done cuando llegó al objetivo', () => {
    const s = goalStatus(make({ loggedSeconds: 21 * 3600 }));
    expect(s.state).toBe('done');
    expect(s.progressPct).toBe(100); // clamp
    expect(s.remainingSeconds).toBe(0);
  });

  it('a fin de mes el ritmo esperado es el objetivo completo', () => {
    const s = goalStatus(make({ loggedSeconds: 0, dayOfMonth: 30, daysInMonth: 30 }));
    expect(s.expectedSeconds).toBe(20 * 3600);
  });
});

describe('goalLabel', () => {
  it('usa el nombre de la etiqueta o "Todas las tareas"', () => {
    expect(goalLabel(make({ tagName: 'Proyecto X' }))).toBe('Proyecto X');
    expect(goalLabel(make({ tagName: null }))).toBe('Todas las tareas');
  });
});
