import { describe, expect, it } from 'vitest';
import { formatSessionText, parseSessionText } from './sessionText';

describe('formatSessionText', () => {
  it('arma "⏱ {duración} ({inicio}–{fin})" con guión largo', () => {
    expect(formatSessionText(1500, '10:15', '10:40')).toBe('⏱ 25m (10:15–10:40)');
    expect(formatSessionText(5445, '09:00', '10:30')).toBe('⏱ 1h 30m 45s (09:00–10:30)');
  });
});

describe('parseSessionText', () => {
  it('lee el formato legado en minutos "⏱ 25m (10:15–10:40)"', () => {
    expect(parseSessionText('⏱ 25m (10:15–10:40)')).toEqual({
      durationSeconds: 1500,
      start: '10:15',
      end: '10:40',
    });
  });

  it('lee el formato con precisión de segundos', () => {
    expect(parseSessionText('⏱ 1h 30m 45s (09:00–10:30)')).toEqual({
      durationSeconds: 5445,
      start: '09:00',
      end: '10:30',
    });
  });

  it('acepta guión normal además de guión largo como separador de horas', () => {
    expect(parseSessionText('⏱ 25m (10:15-10:40)')).toEqual({
      durationSeconds: 1500,
      start: '10:15',
      end: '10:40',
    });
  });

  it('encuentra la sesión aunque haya texto delante', () => {
    expect(parseSessionText('trabajo ⏱ 25m (10:15–10:40)')?.durationSeconds).toBe(1500);
  });

  it('redondea a segundos enteros (mínimo 1)', () => {
    expect(parseSessionText('⏱ 1h 30m 45.5s (09:00–10:30)')?.durationSeconds).toBe(5446);
    expect(parseSessionText('⏱ 0m (10:00–10:00)')?.durationSeconds).toBe(1);
  });

  it('devuelve null si no hay bloque de sesión o la duración no parsea', () => {
    expect(parseSessionText('nada que ver acá')).toBeNull();
    expect(parseSessionText('⏱ basura (10:00–10:30)')).toBeNull();
  });
});

describe('round-trip formatSessionText ↔ parseSessionText', () => {
  // Garantía clave: lo que se escribe en Notion se vuelve a leer con la
  // misma duración en segundos.
  it.each([1, 45, 1500, 5400, 5445, 7245])('%i segundos sobreviven la ida y vuelta', (seconds) => {
    const text = formatSessionText(seconds, '10:00', '11:00');
    expect(parseSessionText(text)).toEqual({ durationSeconds: seconds, start: '10:00', end: '11:00' });
  });
});
