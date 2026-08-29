import { describe, expect, it } from 'vitest';
import { movableTargets } from './components/TaskRowMenu';
import type { DayColumn } from './types';

const days: DayColumn[] = [
  { day: 'Lunes', date: '2026-08-24' },
  { day: 'Martes', date: '2026-08-25' },
  { day: 'Miércoles', date: '2026-08-26' },
];

describe('movableTargets', () => {
  it('excluye el día actual', () => {
    expect(movableTargets(days, 'Martes').map((d) => d.day)).toEqual(['Lunes', 'Miércoles']);
  });

  it('devuelve todos si el día actual no está en la lista', () => {
    expect(movableTargets(days, 'Viernes')).toHaveLength(3);
  });

  it('devuelve todos si no se excluye ninguno', () => {
    expect(movableTargets(days, null)).toHaveLength(3);
  });

  it('preserva el orden original', () => {
    expect(movableTargets(days, 'Lunes').map((d) => d.day)).toEqual(['Martes', 'Miércoles']);
  });
});
