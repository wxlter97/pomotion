import { describe, expect, it } from 'vitest';
import {
  addDays,
  adjacentDayTarget,
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
  it('un fin de semana → lunes de esa misma semana, si no está visible', () => {
    expect(weekTargetForDate('2026-08-29')).toEqual({
      week: '2026.08.24 - 2026.08.28',
      day: 'Lunes',
    });
    expect(weekTargetForDate('2026-08-30')).toEqual({
      week: '2026.08.24 - 2026.08.28',
      day: 'Lunes',
    });
  });
  it('un fin de semana → su propio día si está visible (includeWeekend)', () => {
    expect(weekTargetForDate('2026-08-29', true)).toEqual({
      week: '2026.08.24 - 2026.08.28',
      day: 'Sábado',
    });
    expect(weekTargetForDate('2026-08-30', true)).toEqual({
      week: '2026.08.24 - 2026.08.28',
      day: 'Domingo',
    });
  });
});

describe('addDays', () => {
  it('suma y resta días, cruzando mes', () => {
    expect(addDays('2026-08-28', 1)).toBe('2026-08-29');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-08-24', -1)).toBe('2026-08-23');
  });
});

describe('adjacentDayTarget', () => {
  it('sin fin de semana visible: viernes → salta al lunes siguiente', () => {
    expect(adjacentDayTarget('2026-08-28', 1, false)).toEqual({
      week: '2026.08.31 - 2026.09.04',
      day: 'Lunes',
    });
  });
  it('sin fin de semana visible: lunes → salta al viernes anterior', () => {
    expect(adjacentDayTarget('2026-08-24', -1, false)).toEqual({
      week: '2026.08.17 - 2026.08.21',
      day: 'Viernes',
    });
  });
  it('con fin de semana visible: viernes → sábado, sin saltar', () => {
    expect(adjacentDayTarget('2026-08-28', 1, true)).toEqual({
      week: '2026.08.24 - 2026.08.28',
      day: 'Sábado',
    });
  });
  it('día laboral a día laboral: un paso simple', () => {
    expect(adjacentDayTarget('2026-08-26', 1, false)).toEqual({
      week: '2026.08.24 - 2026.08.28',
      day: 'Jueves',
    });
  });
});
