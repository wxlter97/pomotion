import { describe, expect, it } from 'vitest';
import {
  TIME_RE,
  formatDurationLabel,
  isValidTimeLabel,
  normalizeTimeLabel,
  parseDurationToSeconds,
  roundDurationSeconds,
} from './duration';

describe('parseDurationToSeconds', () => {
  it('interpreta un número plano como MINUTOS', () => {
    expect(parseDurationToSeconds('90')).toBe(5400);
    expect(parseDurationToSeconds('1')).toBe(60);
    expect(parseDurationToSeconds('25')).toBe(1500);
  });

  it('acepta decimales en el número plano sin redondear', () => {
    expect(parseDurationToSeconds('1.5')).toBe(90);
    expect(parseDurationToSeconds('0.5')).toBe(30);
  });

  it('un "0" plano devuelve 0 (no null) — el mínimo lo aplica roundDurationSeconds', () => {
    expect(parseDurationToSeconds('0')).toBe(0);
  });

  it('parsea formato tipo Jira sumando h/m/s', () => {
    expect(parseDurationToSeconds('1h 30m 45s')).toBe(5445);
    expect(parseDurationToSeconds('1h30m45s')).toBe(5445);
    expect(parseDurationToSeconds('1h30m')).toBe(5400);
    expect(parseDurationToSeconds('2h')).toBe(7200);
    expect(parseDurationToSeconds('90m')).toBe(5400);
    expect(parseDurationToSeconds('45s')).toBe(45);
  });

  it('es insensible a mayúsculas y a espacios internos/externos', () => {
    expect(parseDurationToSeconds('1H 30M')).toBe(5400);
    expect(parseDurationToSeconds('  1h   30m  ')).toBe(5400);
    expect(parseDurationToSeconds('1h\t30m')).toBe(5400);
  });

  it('acepta decimales dentro del formato Jira, exactos (sin redondeo intermedio)', () => {
    expect(parseDurationToSeconds('1.5h')).toBe(5400);
    expect(parseDurationToSeconds('1h 30m 45.5s')).toBe(5445.5);
  });

  it('devuelve null para cadena vacía o solo espacios', () => {
    expect(parseDurationToSeconds('')).toBeNull();
    expect(parseDurationToSeconds('   ')).toBeNull();
  });

  it('devuelve null para strings que no matchean ningún formato', () => {
    expect(parseDurationToSeconds('abc')).toBeNull();
    expect(parseDurationToSeconds('1x')).toBeNull();
    expect(parseDurationToSeconds('h')).toBeNull();
    expect(parseDurationToSeconds('-5')).toBeNull();
    expect(parseDurationToSeconds('1:30')).toBeNull();
  });

  it('exige el orden h → m → s (partes desordenadas no matchean)', () => {
    expect(parseDurationToSeconds('30m 1h')).toBeNull();
    expect(parseDurationToSeconds('45s 30m')).toBeNull();
  });
});

describe('roundDurationSeconds', () => {
  it('redondea al segundo entero más cercano', () => {
    expect(roundDurationSeconds(5445.4)).toBe(5445);
    expect(roundDurationSeconds(5445.5)).toBe(5446);
    expect(roundDurationSeconds(100)).toBe(100);
  });

  it('nunca devuelve menos de 1 (ni 0 ni negativo)', () => {
    expect(roundDurationSeconds(0)).toBe(1);
    expect(roundDurationSeconds(0.4)).toBe(1);
    expect(roundDurationSeconds(-10)).toBe(1);
  });
});

describe('formatDurationLabel', () => {
  it('omite las partes en cero', () => {
    expect(formatDurationLabel(1500)).toBe('25m');
    expect(formatDurationLabel(5400)).toBe('1h 30m');
    expect(formatDurationLabel(45)).toBe('45s');
    expect(formatDurationLabel(3600)).toBe('1h');
    expect(formatDurationLabel(60)).toBe('1m');
  });

  it('salta una parte intermedia en cero (ej. horas + segundos sin minutos)', () => {
    expect(formatDurationLabel(7245)).toBe('2h 45s');
  });

  it('muestra las tres partes cuando hacen falta', () => {
    expect(formatDurationLabel(3661)).toBe('1h 1m 1s');
  });

  it('redondea al segundo antes de formatear', () => {
    expect(formatDurationLabel(29.5)).toBe('30s');
    expect(formatDurationLabel(89)).toBe('1m 29s');
  });

  it('devuelve "0m" para cero o negativos', () => {
    expect(formatDurationLabel(0)).toBe('0m');
    expect(formatDurationLabel(-30)).toBe('0m');
  });
});

describe('round-trip formatDurationLabel ↔ parseDurationToSeconds', () => {
  // Garantía clave: lo que se escribe en Notion (formatDurationLabel, vía
  // formatSessionText en api/session.ts) se vuelve a leer con el mismo valor.
  it.each([1, 45, 60, 1500, 3600, 5400, 5445, 7200, 7245])(
    'parseDurationToSeconds(formatDurationLabel(%i)) === %i',
    (seconds) => {
      expect(parseDurationToSeconds(formatDurationLabel(seconds))).toBe(seconds);
    }
  );
});

describe('TIME_RE / isValidTimeLabel', () => {
  it('acepta "HH:MM" (una o dos cifras de hora, dos de minutos)', () => {
    expect(isValidTimeLabel('09:30')).toBe(true);
    expect(isValidTimeLabel('9:30')).toBe(true);
    expect(isValidTimeLabel('23:45')).toBe(true);
    expect(isValidTimeLabel('0:00')).toBe(true);
  });

  it('recorta espacios antes de validar', () => {
    expect(isValidTimeLabel('  10:00  ')).toBe(true);
  });

  it('rechaza formatos que no son "HH:MM"', () => {
    expect(isValidTimeLabel('1000')).toBe(false);
    expect(isValidTimeLabel('10:0')).toBe(false);
    expect(isValidTimeLabel('10:5')).toBe(false);
    expect(isValidTimeLabel('10.00')).toBe(false);
    expect(isValidTimeLabel('')).toBe(false);
    expect(isValidTimeLabel('ab:cd')).toBe(false);
  });

  it('es un chequeo de FORMATO, no de rango (no valida horas/minutos reales)', () => {
    // Limitación conocida: "25:99" pasa el formato. La validación de rango,
    // si algún día hace falta, va en otro lado.
    expect(TIME_RE.test('25:99')).toBe(true);
  });
});

describe('normalizeTimeLabel', () => {
  it('zero-pea la hora (los minutos ya vienen de a dos dígitos por TIME_RE)', () => {
    expect(normalizeTimeLabel('9:05')).toBe('09:05');
    expect(normalizeTimeLabel('0:00')).toBe('00:00');
  });

  it('deja igual una "HH:MM" ya zero-padeada', () => {
    expect(normalizeTimeLabel('09:30')).toBe('09:30');
    expect(normalizeTimeLabel('  23:45  ')).toBe('23:45');
  });

  it('devuelve null si no matchea TIME_RE', () => {
    expect(normalizeTimeLabel('9am')).toBeNull();
    expect(normalizeTimeLabel('')).toBeNull();
  });
});
