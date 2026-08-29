import { describe, expect, it } from 'vitest';
import { overrunElapsedHours, shouldWarnOverrun } from './timerOverrun';

const H = 3_600_000;

describe('overrunElapsedHours', () => {
  it('devuelve horas enteras (piso)', () => {
    expect(overrunElapsedHours(0)).toBe(0);
    expect(overrunElapsedHours(1.5 * H)).toBe(1);
    expect(overrunElapsedHours(2 * H)).toBe(2);
    expect(overrunElapsedHours(2.99 * H)).toBe(2);
  });
});

describe('shouldWarnOverrun', () => {
  const base = { running: true, posting: false, ackHours: 0 };

  it('no avisa antes de las 2h', () => {
    expect(shouldWarnOverrun({ ...base, elapsedMs: 1.99 * H })).toBe(false);
  });

  it('avisa al cruzar las 2h', () => {
    expect(shouldWarnOverrun({ ...base, elapsedMs: 2 * H })).toBe(true);
    expect(shouldWarnOverrun({ ...base, elapsedMs: 2.5 * H })).toBe(true);
  });

  it('no avisa si el timer no está corriendo o se está guardando', () => {
    expect(shouldWarnOverrun({ ...base, running: false, elapsedMs: 5 * H })).toBe(false);
    expect(shouldWarnOverrun({ ...base, posting: true, elapsedMs: 5 * H })).toBe(false);
  });

  it('deja de avisar tras ignorar, hasta la hora siguiente', () => {
    // Usuario ignora a las 2h → ackHours 2.
    expect(shouldWarnOverrun({ ...base, elapsedMs: 2.5 * H, ackHours: 2 })).toBe(false);
    // A las 3h vuelve a avisar.
    expect(shouldWarnOverrun({ ...base, elapsedMs: 3 * H, ackHours: 2 })).toBe(true);
    // Ignora de nuevo → ackHours 3, silencio hasta las 4h.
    expect(shouldWarnOverrun({ ...base, elapsedMs: 3.7 * H, ackHours: 3 })).toBe(false);
    expect(shouldWarnOverrun({ ...base, elapsedMs: 4 * H, ackHours: 3 })).toBe(true);
  });
});
