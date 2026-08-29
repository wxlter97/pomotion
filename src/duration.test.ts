import { afterEach, describe, expect, it, vi } from 'vitest';
import { addMinutesToTime, nowAsHHMM, parseDurationToSeconds } from './duration';

describe('re-exports de ../shared/duration', () => {
  it('expone los helpers compartidos', () => {
    // Sanity check de que el barrel no se rompió (los tests exhaustivos de
    // estas funciones viven en shared/duration.test.ts).
    expect(parseDurationToSeconds('90')).toBe(5400);
  });
});

describe('addMinutesToTime', () => {
  it('suma minutos dentro del mismo día', () => {
    expect(addMinutesToTime('10:00', 90)).toBe('11:30');
    expect(addMinutesToTime('09:15', 0)).toBe('09:15');
  });

  it('hace rollover de medianoche hacia adelante', () => {
    expect(addMinutesToTime('23:45', 30)).toBe('00:15');
    expect(addMinutesToTime('10:00', 1440)).toBe('10:00');
    expect(addMinutesToTime('10:00', 1440 * 2 + 30)).toBe('10:30');
  });

  it('hace rollover de medianoche hacia atrás con minutos negativos', () => {
    expect(addMinutesToTime('00:00', -1)).toBe('23:59');
    expect(addMinutesToTime('10:00', -120)).toBe('08:00');
  });

  it('normaliza el padding de ceros y recorta espacios', () => {
    expect(addMinutesToTime('9:05', 10)).toBe('09:15');
    expect(addMinutesToTime(' 10:00 ', 30)).toBe('10:30');
  });

  it('redondea minutos fraccionarios', () => {
    expect(addMinutesToTime('10:00', 15.5)).toBe('10:16');
  });

  it('devuelve el input sin cambios si no tiene formato "HH:MM"', () => {
    expect(addMinutesToTime('abc', 30)).toBe('abc');
    expect(addMinutesToTime('', 30)).toBe('');
  });
});

describe('nowAsHHMM', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('devuelve la hora local actual como "HH:MM" con padding', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15, 9, 5));
    expect(nowAsHHMM()).toBe('09:05');
  });

  it('siempre tiene la forma "HH:MM"', () => {
    expect(nowAsHHMM()).toMatch(/^\d{2}:\d{2}$/);
  });
});
