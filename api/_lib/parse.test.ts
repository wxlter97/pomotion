import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDurationLabel } from '../../shared/duration';
import {
  addDaysToDate,
  computeNextWeekRange,
  extractNotionPageId,
  formatWeekLabel,
  isDateInRange,
  nextMondayAfter,
  normalize,
  parseSessionText,
  parseWeekRange,
  plainText,
  stripNotionReference,
  todayDateStringInTz,
  todayWeekdayNameInTz,
} from './parse';

describe('plainText', () => {
  it('concatena los plain_text y recorta', () => {
    expect(plainText([{ plain_text: 'Hola' }, { plain_text: ' mundo' }])).toBe('Hola mundo');
    expect(plainText([{ plain_text: '  espaciado  ' }])).toBe('espaciado');
  });

  it('tolera items sin plain_text y entradas vacías', () => {
    expect(plainText([{ plain_text: 'a' }, {}, { plain_text: 'b' }])).toBe('ab');
    expect(plainText([])).toBe('');
    expect(plainText(undefined)).toBe('');
  });
});

describe('normalize', () => {
  it('pasa a minúsculas, saca acentos y recorta', () => {
    expect(normalize('Lunes')).toBe('lunes');
    expect(normalize('MIÉRCOLES')).toBe('miercoles');
    expect(normalize('  Café  ')).toBe('cafe');
  });
});

describe('parseWeekRange', () => {
  it('extrae el rango "YYYY.MM.DD - YYYY.MM.DD" como fechas ISO', () => {
    expect(parseWeekRange('2026.08.17 - 2026.08.21')).toEqual({
      start: '2026-08-17',
      end: '2026-08-21',
    });
  });

  it('encuentra el rango aunque haya texto alrededor y sin espacios en el guión', () => {
    expect(parseWeekRange('Semana 2026.08.17-2026.08.21 (actual)')).toEqual({
      start: '2026-08-17',
      end: '2026-08-21',
    });
  });

  it('devuelve null si no hay un rango con el formato esperado', () => {
    expect(parseWeekRange('sin fechas')).toBeNull();
    expect(parseWeekRange('2026.8.17 - 2026.8.21')).toBeNull();
  });
});

describe('isDateInRange', () => {
  it('es inclusivo en ambos extremos', () => {
    expect(isDateInRange('2026-08-17', '2026-08-17', '2026-08-21')).toBe(true);
    expect(isDateInRange('2026-08-21', '2026-08-17', '2026-08-21')).toBe(true);
    expect(isDateInRange('2026-08-19', '2026-08-17', '2026-08-21')).toBe(true);
  });

  it('deja afuera lo que cae fuera del rango', () => {
    expect(isDateInRange('2026-08-16', '2026-08-17', '2026-08-21')).toBe(false);
    expect(isDateInRange('2026-08-22', '2026-08-17', '2026-08-21')).toBe(false);
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

  it('round-trip con formatDurationLabel: lo que se escribe se relee igual', () => {
    // Espeja formatSessionText de api/session.ts: "⏱ {label} ({start}–{end})".
    for (const seconds of [1, 45, 1500, 5400, 5445, 7245]) {
      const text = `⏱ ${formatDurationLabel(seconds)} (10:00–11:00)`;
      expect(parseSessionText(text)?.durationSeconds).toBe(seconds);
    }
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

describe('nextMondayAfter', () => {
  it('devuelve el lunes estrictamente posterior a la fecha dada', () => {
    // 2024-01-01 es lunes.
    expect(nextMondayAfter('2024-01-01')).toBe('2024-01-08');
    expect(nextMondayAfter('2024-01-03')).toBe('2024-01-08');
    expect(nextMondayAfter('2024-01-07')).toBe('2024-01-08');
  });
});

describe('computeNextWeekRange', () => {
  it('sin semanas previas, arranca el lunes siguiente a "hoy"', () => {
    expect(computeNextWeekRange([], '2024-01-03')).toEqual({
      start: '2024-01-08',
      end: '2024-01-12',
    });
  });

  it('usa el fin de semana más tardío si es posterior a "hoy"', () => {
    expect(computeNextWeekRange(['2024-01-20'], '2024-01-03')).toEqual({
      start: '2024-01-22',
      end: '2024-01-26',
    });
  });

  it('nunca sugiere una semana ya pasada aunque las existentes sean viejas', () => {
    expect(computeNextWeekRange(['2020-01-01'], '2024-01-03')).toEqual({
      start: '2024-01-08',
      end: '2024-01-12',
    });
  });
});

describe('formatWeekLabel', () => {
  it('arma la etiqueta "YYYY.MM.DD - YYYY.MM.DD"', () => {
    expect(formatWeekLabel('2026-08-17', '2026-08-21')).toBe('2026.08.17 - 2026.08.21');
  });

  it('round-trip con parseWeekRange', () => {
    expect(parseWeekRange(formatWeekLabel('2026-08-17', '2026-08-21'))).toEqual({
      start: '2026-08-17',
      end: '2026-08-21',
    });
  });
});

describe('extractNotionPageId', () => {
  const canonical = '01234567-89ab-cdef-0123-456789abcdef';

  it('normaliza un ID crudo de 32 hex a la forma con guiones', () => {
    expect(extractNotionPageId('0123456789abcdef0123456789abcdef')).toBe(canonical);
  });

  it('acepta un ID ya con guiones', () => {
    expect(extractNotionPageId(canonical)).toBe(canonical);
  });

  it('extrae el ID de una URL de Notion y lo pasa a minúsculas', () => {
    expect(extractNotionPageId('https://www.notion.so/Page-0123456789ABCDEF0123456789ABCDEF')).toBe(
      canonical
    );
  });

  it('devuelve null si no hay nada con forma de ID', () => {
    expect(extractNotionPageId('no hay id acá')).toBeNull();
    expect(extractNotionPageId('12345')).toBeNull();
  });
});

describe('stripNotionReference', () => {
  it('quita una URL y el separador final para quedarse con la etiqueta', () => {
    expect(
      stripNotionReference('Trabajo: https://notion.so/x0123456789abcdef0123456789abcdef')
    ).toBe('Trabajo');
  });

  it('quita un ID suelto y el guión separador', () => {
    expect(stripNotionReference('Casa - 0123456789abcdef0123456789abcdef')).toBe('Casa');
  });

  it('deja intacto un texto sin referencia', () => {
    expect(stripNotionReference('Hábitos')).toBe('Hábitos');
    expect(stripNotionReference('  Trabajo  ')).toBe('Trabajo');
  });
});

describe('todayDateStringInTz / todayWeekdayNameInTz', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('da la fecha del día en la zona horaria pedida', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T12:00:00Z'));
    expect(todayDateStringInTz('America/El_Salvador')).toBe('2026-08-17');
  });

  it('respeta el corrimiento de zona cerca de medianoche UTC', () => {
    vi.useFakeTimers();
    // 02:00 UTC del 17 → todavía 16 de agosto, 20:00, en El Salvador (UTC-6).
    vi.setSystemTime(new Date('2026-08-17T02:00:00Z'));
    expect(todayDateStringInTz('America/El_Salvador')).toBe('2026-08-16');
  });

  it('da el nombre del día de la semana normalizado', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z')); // lunes
    expect(todayWeekdayNameInTz('America/El_Salvador')).toBe('lunes');
  });
});
