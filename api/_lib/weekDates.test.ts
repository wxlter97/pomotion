import { describe, expect, it, vi } from 'vitest';
import {
  WEEKDAY_NAMES,
  mondayOf,
  resolveWeekStart,
  selectDay,
  weekDates,
  weekLabelOf,
  weekdayIndex,
  weekdayNameOf,
} from './weekDates.js';

describe('mondayOf', () => {
  it('un miércoles → el lunes de esa semana', () => {
    expect(mondayOf('2026-08-26')).toBe('2026-08-24'); // 2026-08-26 es miércoles
  });
  it('un lunes → sí mismo', () => {
    expect(mondayOf('2026-08-24')).toBe('2026-08-24');
  });
  it('un domingo → el lunes anterior (semana ISO)', () => {
    expect(mondayOf('2026-08-30')).toBe('2026-08-24');
  });
  it('cruza mes', () => {
    expect(mondayOf('2026-09-01')).toBe('2026-08-31'); // martes → lunes 31 ago
  });
});

describe('weekDates / weekLabelOf', () => {
  it('5 fechas Lun–Vie', () => {
    expect(weekDates('2026-08-24')).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
    ]);
  });
  it('etiqueta con puntos', () => {
    expect(weekLabelOf('2026-08-24')).toBe('2026.08.24 - 2026.08.28');
  });
});

describe('resolveWeekStart', () => {
  it('parsea el label pedido', () => {
    expect(resolveWeekStart('2026.08.24 - 2026.08.28', 'UTC')).toBe('2026-08-24');
  });
  it('label basura → lunes de hoy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z')); // miércoles
    expect(resolveWeekStart('no-es-una-semana', 'UTC')).toBe('2026-08-24');
    vi.useRealTimers();
  });
  it('sin label → lunes de hoy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T12:00:00Z')); // viernes
    expect(resolveWeekStart(undefined, 'UTC')).toBe('2026-08-24');
    vi.useRealTimers();
  });
});

describe('weekdayIndex / weekdayNameOf', () => {
  it('índice por etiqueta, insensible a acentos', () => {
    expect(weekdayIndex('Miércoles')).toBe(2);
    expect(weekdayIndex('miercoles')).toBe(2);
    expect(weekdayIndex('Sábado')).toBeNull();
  });
  it('nombre por fecha; null en fin de semana', () => {
    expect(weekdayNameOf('2026-08-24')).toBe('Lunes');
    expect(weekdayNameOf('2026-08-28')).toBe('Viernes');
    expect(weekdayNameOf('2026-08-29')).toBeNull(); // sábado
  });
});

describe('selectDay', () => {
  it('respeta el día pedido si es válido', () => {
    expect(selectDay({ requestedDay: 'jueves', isCurrentWeek: false, timeZone: 'UTC' })).toBe('Jueves');
  });
  it('semana actual sin día pedido → hoy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z')); // miércoles
    expect(selectDay({ isCurrentWeek: true, timeZone: 'UTC' })).toBe('Miércoles');
    vi.useRealTimers();
  });
  it('semana no actual sin día pedido → Lunes', () => {
    expect(selectDay({ isCurrentWeek: false, timeZone: 'UTC' })).toBe('Lunes');
  });
  it('fin de semana en la semana actual → Lunes (hoy no es laboral)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-29T12:00:00Z')); // sábado
    expect(selectDay({ isCurrentWeek: true, timeZone: 'UTC' })).toBe('Lunes');
    vi.useRealTimers();
  });
  it('WEEKDAY_NAMES son 5', () => {
    expect(WEEKDAY_NAMES).toHaveLength(5);
  });
});
