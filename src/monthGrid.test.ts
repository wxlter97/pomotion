import { describe, expect, it } from 'vitest';
import {
  isWeekend,
  mondayIndex,
  mondayOf,
  monthGrid,
  monthTitle,
  weekTargetForDate,
} from './monthGrid';

describe('mondayIndex', () => {
  it('0 el lunes, 6 el domingo', () => {
    expect(mondayIndex('2026-08-24')).toBe(0); // lunes
    expect(mondayIndex('2026-08-28')).toBe(4); // viernes
    expect(mondayIndex('2026-08-29')).toBe(5); // sábado
    expect(mondayIndex('2026-08-30')).toBe(6); // domingo
  });
});

describe('mondayOf', () => {
  it('el lunes de la semana que contiene la fecha', () => {
    expect(mondayOf('2026-08-26')).toBe('2026-08-24'); // miércoles
    expect(mondayOf('2026-08-24')).toBe('2026-08-24');
    expect(mondayOf('2026-08-30')).toBe('2026-08-24'); // domingo → lunes previo
    expect(mondayOf('2026-09-01')).toBe('2026-08-31'); // cruza mes
  });
});

describe('isWeekend', () => {
  it('sábado y domingo', () => {
    expect(isWeekend('2026-08-28')).toBe(false);
    expect(isWeekend('2026-08-29')).toBe(true);
    expect(isWeekend('2026-08-30')).toBe(true);
    expect(isWeekend('2026-08-31')).toBe(false);
  });
});

describe('monthGrid', () => {
  it('agosto 2026 arranca sábado: 5 huecos de relleno antes del día 1', () => {
    const weeks = monthGrid('2026-08');
    expect(weeks[0]).toEqual([null, null, null, null, null, '2026-08-01', '2026-08-02']);
    expect(weeks.flat().filter((c) => c !== null)).toEqual(
      Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`)
    );
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('febrero 2026 (28 días, arranca domingo)', () => {
    const weeks = monthGrid('2026-02');
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-02-01']);
    expect(weeks.flat().filter((c) => c !== null)).toHaveLength(28);
  });

  it('febrero 2024 bisiesto → 29 días', () => {
    expect(monthGrid('2024-02').flat().filter((c) => c !== null)).toHaveLength(29);
  });
});

describe('monthTitle', () => {
  it('nombre del mes capitalizado + año', () => {
    expect(monthTitle('2026-08')).toBe('Agosto 2026');
    expect(monthTitle('2026-01')).toBe('Enero 2026');
  });
});

describe('weekTargetForDate', () => {
  it('un día laboral → su semana y su día', () => {
    expect(weekTargetForDate('2026-08-26')).toEqual({
      week: '2026.08.24 - 2026.08.28',
      day: 'Miércoles',
    });
  });
  it('un fin de semana → lunes de esa misma semana', () => {
    expect(weekTargetForDate('2026-08-29')).toEqual({
      week: '2026.08.24 - 2026.08.28',
      day: 'Lunes',
    });
    expect(weekTargetForDate('2026-08-30')).toEqual({
      week: '2026.08.24 - 2026.08.28',
      day: 'Lunes',
    });
  });
});
