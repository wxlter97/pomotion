import { describe, expect, it } from 'vitest';
import { movableTargets } from './components/MoveTaskMenu';
import type { DayContainer } from './types';

const days: DayContainer[] = [
  { day: 'Lunes', containerId: 'c1', headingBlockId: 'h1' },
  { day: 'Martes', containerId: 'c2', headingBlockId: 'h2' },
  { day: 'Miércoles', containerId: 'c3', headingBlockId: 'h3' },
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
