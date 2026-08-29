import { describe, expect, it } from 'vitest';
import {
  computeWeekNav,
  findTodayWeekIndex,
  hasValidRange,
  selectActiveWeek,
  selectDay,
  weekdayOffset,
  type WeekSummary,
} from './weekModel';

const w = (label: string, start?: string, end?: string): WeekSummary => ({
  label,
  range: start && end ? { start, end } : null,
});

describe('hasValidRange', () => {
  it('rechaza rango nulo y start > end', () => {
    expect(hasValidRange(w('sin rango'))).toBe(false);
    expect(hasValidRange(w('typo', '2026-08-21', '2026-08-17'))).toBe(false);
  });
  it('acepta rango normal y rango de un solo día', () => {
    expect(hasValidRange(w('ok', '2026-08-17', '2026-08-21'))).toBe(true);
    expect(hasValidRange(w('un día', '2026-08-17', '2026-08-17'))).toBe(true);
  });
});

describe('findTodayWeekIndex', () => {
  const weeks = [
    w('s1', '2026-08-10', '2026-08-14'),
    w('s2', '2026-08-17', '2026-08-21'),
    w('sin rango'),
  ];

  it('encuentra la semana que contiene hoy (inclusive en los bordes)', () => {
    expect(findTodayWeekIndex(weeks, '2026-08-19')).toBe(1);
    expect(findTodayWeekIndex(weeks, '2026-08-17')).toBe(1);
    expect(findTodayWeekIndex(weeks, '2026-08-21')).toBe(1);
    expect(findTodayWeekIndex(weeks, '2026-08-10')).toBe(0);
  });

  it('devuelve -1 si hoy cae en un hueco o no hay semanas', () => {
    expect(findTodayWeekIndex(weeks, '2026-08-15')).toBe(-1);
    expect(findTodayWeekIndex([], '2026-08-19')).toBe(-1);
  });

  it('ignora semanas con rango inválido aunque "contengan" hoy', () => {
    expect(findTodayWeekIndex([w('typo', '2026-08-21', '2026-08-17')], '2026-08-19')).toBe(-1);
  });
});

describe('selectActiveWeek', () => {
  const weeks = [
    w('2026.08.10 - 2026.08.14', '2026-08-10', '2026-08-14'),
    w('2026.08.17 - 2026.08.21', '2026-08-17', '2026-08-21'),
    w('2026.08.24 - 2026.08.28', '2026-08-24', '2026-08-28'),
  ];

  it('requested: elige por label', () => {
    const r = selectActiveWeek(weeks, '2026-08-19', '2026.08.24 - 2026.08.28');
    expect(r).toMatchObject({ activeIndex: 2, weekSource: 'requested' });
  });

  it('requested inexistente: activeIndex -1 (el caller responde 404)', () => {
    const r = selectActiveWeek(weeks, '2026-08-19', 'no existe');
    expect(r).toMatchObject({ activeIndex: -1, weekSource: 'requested' });
  });

  it('requested vacío ("") no cuenta como pedido explícito', () => {
    const r = selectActiveWeek(weeks, '2026-08-19', '');
    expect(r).toMatchObject({ activeIndex: 1, weekSource: 'auto-matched' });
  });

  it('auto-matched: hoy cae dentro de una semana', () => {
    const r = selectActiveWeek(weeks, '2026-08-26', undefined);
    expect(r).toMatchObject({ activeIndex: 2, weekSource: 'auto-matched', todayWeekIndex: 2 });
  });

  it('auto-fallback: sin match, prefiere la semana pasada más reciente', () => {
    const r = selectActiveWeek(weeks, '2026-08-23', undefined); // domingo entre s2 y s3
    expect(r).toMatchObject({ activeIndex: 1, weekSource: 'auto-fallback', todayWeekIndex: -1 });
  });

  it('auto-fallback: si todo es futuro, la semana más próxima a empezar', () => {
    const r = selectActiveWeek(weeks, '2026-08-01', undefined);
    expect(r).toMatchObject({ activeIndex: 0, weekSource: 'auto-fallback' });
  });

  it('auto-fallback: pasado gana sobre futuro cuando hay de los dos', () => {
    const mixed = [
      w('futura', '2026-09-01', '2026-09-05'),
      w('pasada', '2026-07-01', '2026-07-05'),
    ];
    const r = selectActiveWeek(mixed, '2026-08-15', undefined);
    expect(r.activeIndex).toBe(1);
  });

  it('auto-fallback: sin ningún rango válido, cae en la primera', () => {
    const noRanges = [w('nota a'), w('nota b')];
    const r = selectActiveWeek(noRanges, '2026-08-15', undefined);
    expect(r).toMatchObject({ activeIndex: 0, weekSource: 'auto-fallback' });
  });
});

describe('computeWeekNav', () => {
  it('semana del medio: anterior y siguiente por fecha de inicio', () => {
    const weeks = [
      w('A', '2026-08-10', '2026-08-14'),
      w('B', '2026-08-17', '2026-08-21'),
      w('C', '2026-08-24', '2026-08-28'),
    ];
    expect(computeWeekNav(weeks, 1)).toEqual({ previousWeekLabel: 'A', nextWeekLabel: 'C' });
  });

  it('ordena cronológicamente aunque el documento liste de más nueva a más vieja', () => {
    const weeks = [
      w('C', '2026-08-24', '2026-08-28'),
      w('B', '2026-08-17', '2026-08-21'),
      w('A', '2026-08-10', '2026-08-14'),
    ];
    // activeIndex 1 = "B" en el array
    expect(computeWeekNav(weeks, 1)).toEqual({ previousWeekLabel: 'A', nextWeekLabel: 'C' });
  });

  it('extremos: null del lado que no existe', () => {
    const weeks = [
      w('A', '2026-08-10', '2026-08-14'),
      w('B', '2026-08-17', '2026-08-21'),
    ];
    expect(computeWeekNav(weeks, 0)).toEqual({ previousWeekLabel: null, nextWeekLabel: 'B' });
    expect(computeWeekNav(weeks, 1)).toEqual({ previousWeekLabel: 'A', nextWeekLabel: null });
  });

  it('semana única: ambos null', () => {
    expect(computeWeekNav([w('sola', '2026-08-17', '2026-08-21')], 0)).toEqual({
      previousWeekLabel: null,
      nextWeekLabel: null,
    });
  });

  it('semana activa sin rango válido: no entra en la navegación', () => {
    const weeks = [w('A', '2026-08-10', '2026-08-14'), w('nota'), w('C', '2026-08-24', '2026-08-28')];
    expect(computeWeekNav(weeks, 1)).toEqual({ previousWeekLabel: null, nextWeekLabel: null });
  });
});

describe('weekdayOffset', () => {
  it('mapea lunes..viernes a 0..4, insensible a acentos y mayúsculas', () => {
    expect(weekdayOffset('Lunes')).toBe(0);
    expect(weekdayOffset('MARTES')).toBe(1);
    expect(weekdayOffset('miércoles')).toBe(2);
    expect(weekdayOffset('Miercoles')).toBe(2);
    expect(weekdayOffset('jueves')).toBe(3);
    expect(weekdayOffset('  Viernes  ')).toBe(4);
  });

  it('devuelve null para etiquetas que no son un día laboral', () => {
    expect(weekdayOffset('Sábado')).toBeNull();
    expect(weekdayOffset('Feriado')).toBeNull();
    expect(weekdayOffset('')).toBeNull();
  });
});

describe('selectDay', () => {
  const dayOrder = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

  it('requestedDay: match insensible a acentos y mayúsculas', () => {
    expect(selectDay(dayOrder, { requestedDay: 'miercoles', weekSource: 'requested', todayWeekday: 'lunes' })).toEqual({
      selectedDay: 'Miércoles',
      dayMatched: true,
    });
  });

  it('requestedDay inexistente: cae al primer día, dayMatched false', () => {
    expect(selectDay(dayOrder, { requestedDay: 'Sábado', weekSource: 'requested', todayWeekday: 'lunes' })).toEqual({
      selectedDay: 'Lunes',
      dayMatched: false,
    });
  });

  it('semana requested sin requestedDay: primer día, dayMatched true (no busca "hoy")', () => {
    expect(selectDay(dayOrder, { weekSource: 'requested', todayWeekday: 'miercoles' })).toEqual({
      selectedDay: 'Lunes',
      dayMatched: true,
    });
  });

  it('auto: elige el día de hoy si la semana lo tiene', () => {
    expect(selectDay(dayOrder, { weekSource: 'auto-matched', todayWeekday: 'jueves' })).toEqual({
      selectedDay: 'Jueves',
      dayMatched: true,
    });
  });

  it('auto: hoy es sábado y la semana es lun-vie → primer día, dayMatched false', () => {
    expect(selectDay(dayOrder, { weekSource: 'auto-fallback', todayWeekday: 'sabado' })).toEqual({
      selectedDay: 'Lunes',
      dayMatched: false,
    });
  });
});
