import { describe, expect, it } from 'vitest';
import {
  computeAnalytics,
  computeEstimateAccuracy,
  computeStreak,
  weekdayMon0,
} from './analytics.js';

describe('weekdayMon0', () => {
  it('0=Lunes .. 6=Domingo', () => {
    expect(weekdayMon0('2026-08-24')).toBe(0); // lunes
    expect(weekdayMon0('2026-08-28')).toBe(4); // viernes
    expect(weekdayMon0('2026-08-29')).toBe(5); // sábado
    expect(weekdayMon0('2026-08-30')).toBe(6); // domingo
  });
});

describe('computeStreak', () => {
  it('cuenta días consecutivos hasta hoy', () => {
    const active = new Set(['2026-08-26', '2026-08-27', '2026-08-28']);
    expect(computeStreak(active, '2026-08-01', '2026-08-28')).toEqual({ current: 3, longest: 3 });
  });

  it('da gracia si hoy todavía no tiene sesión', () => {
    const active = new Set(['2026-08-26', '2026-08-27']);
    // hoy = 28, sin sesión → arranca desde el 27
    expect(computeStreak(active, '2026-08-01', '2026-08-28').current).toBe(2);
  });

  it('un fin de semana vacío no corta la racha', () => {
    // viernes 28 y lunes 31 activos, sáb/dom vacíos
    const active = new Set(['2026-08-28', '2026-08-31']);
    expect(computeStreak(active, '2026-08-24', '2026-08-31').current).toBe(2);
  });

  it('un día laboral vacío sí corta', () => {
    const active = new Set(['2026-08-25', '2026-08-27']); // falta el 26 (miércoles)
    expect(computeStreak(active, '2026-08-24', '2026-08-27').current).toBe(1);
    expect(computeStreak(active, '2026-08-24', '2026-08-27').longest).toBe(1);
  });

  it('sin actividad → 0 y 0', () => {
    expect(computeStreak(new Set(), '2026-08-01', '2026-08-28')).toEqual({ current: 0, longest: 0 });
  });
});

describe('computeAnalytics', () => {
  const opts = { weeks: 2, startMonday: '2026-08-17', endDate: '2026-08-28' };

  it('agrupa por día de semana, hora y semana', () => {
    const a = computeAnalytics(
      [
        { date: '2026-08-17', start: '09:15', durationSec: 3600 }, // lunes, semana 1
        { date: '2026-08-19', start: '14:00', durationSec: 1800 }, // miércoles, semana 1
        { date: '2026-08-24', start: '09:45', durationSec: 900 }, // lunes, semana 2
      ],
      [
        { date: '2026-08-17', done: true },
        { date: '2026-08-18', done: false },
        { date: '2026-08-24', done: true },
      ],
      opts
    );

    expect(a.totalSeconds).toBe(6300);
    expect(a.activeDays).toBe(3);
    expect(a.byWeekday[0].totalSeconds).toBe(4500); // lunes = 3600 + 900
    expect(a.byWeekday[2].totalSeconds).toBe(1800); // miércoles
    expect(a.byHour[9].totalSeconds).toBe(4500);
    expect(a.byHour[14].totalSeconds).toBe(1800);
    expect(a.byWeek).toHaveLength(2);
    expect(a.byWeek[0]).toMatchObject({ weekStart: '2026-08-17', totalSeconds: 5400 });
    expect(a.byWeek[1]).toMatchObject({ weekStart: '2026-08-24', totalSeconds: 900 });
    expect(a.completion).toEqual({ total: 3, done: 2 });
  });

  it('descarta lo que cae fuera de la ventana', () => {
    const a = computeAnalytics(
      [{ date: '2026-08-10', start: '09:00', durationSec: 3600 }],
      [{ date: '2026-08-10', done: true }],
      opts
    );
    expect(a.totalSeconds).toBe(0);
    expect(a.completion.total).toBe(0);
  });

  it('estimateAccuracy es null sin el 4º argumento', () => {
    const a = computeAnalytics([], [], opts);
    expect(a.estimateAccuracy).toBeNull();
  });
});

describe('computeEstimateAccuracy', () => {
  it('null si hay menos de 3 tareas con estimación + tiempo', () => {
    expect(computeEstimateAccuracy([])).toBeNull();
    expect(
      computeEstimateAccuracy([
        { estimateMinutes: 60, loggedSeconds: 3600 },
        { estimateMinutes: 30, loggedSeconds: 1800 },
      ])
    ).toBeNull();
  });

  it('ignora tareas sin estimación o sin tiempo registrado', () => {
    const a = computeEstimateAccuracy([
      { estimateMinutes: 60, loggedSeconds: 3600 },
      { estimateMinutes: 60, loggedSeconds: 3600 },
      { estimateMinutes: 60, loggedSeconds: 3600 },
      { estimateMinutes: 0, loggedSeconds: 9999 }, // sin estimación
      { estimateMinutes: 120, loggedSeconds: 0 }, // sin tiempo
    ]);
    expect(a?.count).toBe(3);
    expect(a?.ratio).toBe(1);
    expect(a?.biasPct).toBe(0);
  });

  it('detecta subestimación: registrado > estimado', () => {
    const a = computeEstimateAccuracy([
      { estimateMinutes: 60, loggedSeconds: 5400 }, // 90m real vs 60m est
      { estimateMinutes: 60, loggedSeconds: 5400 },
      { estimateMinutes: 60, loggedSeconds: 5400 },
    ]);
    expect(a?.ratio).toBeCloseTo(1.5);
    expect(a?.biasPct).toBe(50);
    expect(a?.suggestedFactor).toBe(1.5);
  });

  it('detecta sobreestimación', () => {
    const a = computeEstimateAccuracy([
      { estimateMinutes: 100, loggedSeconds: 3000 }, // 50m real vs 100m est
      { estimateMinutes: 100, loggedSeconds: 3000 },
      { estimateMinutes: 100, loggedSeconds: 3000 },
    ]);
    expect(a?.biasPct).toBe(-50);
    expect(a?.suggestedFactor).toBe(0.5);
  });
});
