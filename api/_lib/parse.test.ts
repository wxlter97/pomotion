import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDaysToDate,
  formatWeekLabel,
  normalize,
  parseWeekRange,
  todayDateStringInTz,
  todayWeekdayNameInTz,
} from './parse';

describe('normalize', () => {
  it('pasa a minúsculas, saca acentos y recorta', () => {
    expect(normalize('Lunes')).toBe('lunes');
    expect(normalize('MIÉRCOLES')).toBe('miercoles');
    expect(normalize('  Café  ')).toBe('cafe');
  });
});

describe('parseWeekRange', () => {
  it('extrae el rango "YYYY.MM.DD - YYYY.MM.DD" como fechas ISO', () => {
    expect(parseWeekRange('2026.08.17 - 2026.08.21')).toEqual({ start: '2026-08-17', end: '2026-08-21' });
  });

  it('encuentra el rango aunque haya texto alrededor y sin espacios en el guión', () => {
    expect(parseWeekRange('Semana 2026.08.17-2026.08.21 (actual)')).toEqual({
      start: '2026-08-17',
      end: '2026-08-21',
    });
  });

  it('tolera `-` o `/` como separador interno (encabezados viejos con typos)', () => {
    expect(parseWeekRange('2025.10.06 - 2025-10.10')).toEqual({ start: '2025-10-06', end: '2025-10-10' });
    expect(parseWeekRange('2025-10-06 – 2025-10-10')).toEqual({ start: '2025-10-06', end: '2025-10-10' });
  });

  it('devuelve null si no hay un rango con el formato esperado', () => {
    expect(parseWeekRange('sin fechas')).toBeNull();
    expect(parseWeekRange('2026.8.17 - 2026.8.21')).toBeNull();
    expect(parseWeekRange('9 al 13 de diciembre')).toBeNull();
  });
});

describe('addDaysToDate', () => {
  it('suma y resta días cruzando meses y años', () => {
    expect(addDaysToDate('2026-08-17', 4)).toBe('2026-08-21');
    expect(addDaysToDate('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysToDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToDate('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDaysToDate('2026-08-17', 0)).toBe('2026-08-17');
  });
});

describe('formatWeekLabel', () => {
  it('arma la etiqueta y hace round-trip con parseWeekRange', () => {
    expect(formatWeekLabel('2026-08-17', '2026-08-21')).toBe('2026.08.17 - 2026.08.21');
    expect(parseWeekRange(formatWeekLabel('2026-08-17', '2026-08-21'))).toEqual({
      start: '2026-08-17',
      end: '2026-08-21',
    });
  });
});

describe('todayDateStringInTz / todayWeekdayNameInTz', () => {
  afterEach(() => vi.useRealTimers());

  it('da la fecha del día en la zona horaria pedida', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T12:00:00Z'));
    expect(todayDateStringInTz('America/El_Salvador')).toBe('2026-08-17');
  });

  it('respeta el corrimiento de zona cerca de medianoche UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T02:00:00Z'));
    expect(todayDateStringInTz('America/El_Salvador')).toBe('2026-08-16');
  });

  it('da el nombre del día de la semana normalizado', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z')); // lunes
    expect(todayWeekdayNameInTz('America/El_Salvador')).toBe('lunes');
  });
});
