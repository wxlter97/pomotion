import { describe, expect, it } from 'vitest';
import {
  clampTimerSettings,
  DEFAULT_TIMER_SETTINGS,
  isLongBreakDue,
} from './timerSettings';

describe('clampTimerSettings', () => {
  it('devuelve los defaults si no hay nada o hay basura', () => {
    expect(clampTimerSettings(undefined)).toEqual(DEFAULT_TIMER_SETTINGS);
    expect(clampTimerSettings('x')).toEqual(DEFAULT_TIMER_SETTINGS);
    expect(clampTimerSettings({ workMinutes: 'abc' })).toEqual(DEFAULT_TIMER_SETTINGS);
  });

  it('acota cada campo a su rango y redondea', () => {
    const s = clampTimerSettings({
      workMinutes: 9999,
      shortBreakMinutes: 0,
      longBreakMinutes: 4.6,
      longBreakEvery: -3,
    });
    expect(s.workMinutes).toBe(180);
    expect(s.shortBreakMinutes).toBe(1);
    expect(s.longBreakMinutes).toBe(5);
    expect(s.longBreakEvery).toBe(0);
  });

  it('mezcla un patch parcial sobre valores previos', () => {
    const prev = { ...DEFAULT_TIMER_SETTINGS, workMinutes: 50 };
    expect(clampTimerSettings({ ...prev, autoStartNext: true })).toEqual({
      ...DEFAULT_TIMER_SETTINGS,
      workMinutes: 50,
      autoStartNext: true,
    });
  });

  it('autoStartNext solo acepta booleano', () => {
    expect(clampTimerSettings({ autoStartNext: 'yes' }).autoStartNext).toBe(false);
    expect(clampTimerSettings({ autoStartNext: true }).autoStartNext).toBe(true);
  });
});

describe('isLongBreakDue', () => {
  it('cada N pomodoros', () => {
    expect(isLongBreakDue(4, 4)).toBe(true);
    expect(isLongBreakDue(8, 4)).toBe(true);
    expect(isLongBreakDue(3, 4)).toBe(false);
    expect(isLongBreakDue(1, 4)).toBe(false);
  });

  it('every = 0 → nunca', () => {
    expect(isLongBreakDue(4, 0)).toBe(false);
    expect(isLongBreakDue(100, 0)).toBe(false);
  });

  it('0 pomodoros completados nunca dispara', () => {
    expect(isLongBreakDue(0, 4)).toBe(false);
  });
});
