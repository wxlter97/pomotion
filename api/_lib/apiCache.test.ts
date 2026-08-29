import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCache, getCached, setCached } from './apiCache';

afterEach(() => {
  clearCache();
  vi.useRealTimers();
});

describe('apiCache', () => {
  it('devuelve undefined en un miss y el valor guardado en un hit', () => {
    expect(getCached('k')).toBeUndefined();
    setCached('k', { a: 1 }, 1000);
    expect(getCached<{ a: number }>('k')).toEqual({ a: 1 });
  });

  it('expira la entrada pasado el TTL', () => {
    vi.useFakeTimers();
    setCached('k', 'v', 1000);
    vi.advanceTimersByTime(999);
    expect(getCached('k')).toBe('v');
    vi.advanceTimersByTime(2);
    expect(getCached('k')).toBeUndefined();
  });

  it('re-setear una clave no la duplica ni la mueve al final de la cola', () => {
    setCached('a', 1, 1000);
    setCached('b', 2, 1000);
    setCached('a', 11, 1000);
    expect(getCached('a')).toBe(11);
  });

  it('al llenarse, evicta la entrada más vieja', () => {
    for (let i = 0; i < 50; i++) setCached(`k${i}`, i, 10_000);
    expect(getCached('k0')).toBe(0);
    setCached('k50', 50, 10_000); // desborda → evicta k0
    expect(getCached('k0')).toBeUndefined();
    expect(getCached('k1')).toBe(1);
    expect(getCached('k50')).toBe(50);
  });
});
