import { describe, expect, it } from 'vitest';
import {
  addBlock,
  clampBusinessHours,
  copyToWeekdays,
  DEFAULT_BUSINESS_HOURS,
  firstBlockStart,
  isoWeekdayOf,
  isValidBlock,
  removeBlock,
  setDayEnabled,
  setFeatureEnabled,
  sortBlocks,
  updateBlock,
  type BusinessHoursSettings,
} from './businessHours';

const ENABLED_MON_FRI: BusinessHoursSettings = {
  ...DEFAULT_BUSINESS_HOURS,
  enabled: true,
};

describe('isValidBlock', () => {
  it('acepta un bloque con horas válidas y start < end', () => {
    expect(isValidBlock({ start: '09:00', end: '13:00' })).toBe(true);
  });

  it('rechaza horas fuera de rango', () => {
    expect(isValidBlock({ start: '7:99', end: '13:00' })).toBe(false);
  });

  it('rechaza start >= end', () => {
    expect(isValidBlock({ start: '13:00', end: '13:00' })).toBe(false);
    expect(isValidBlock({ start: '14:00', end: '13:00' })).toBe(false);
  });
});

describe('sortBlocks', () => {
  it('ordena por hora de inicio sin mutar el original', () => {
    const blocks = [
      { start: '14:00', end: '18:00' },
      { start: '09:00', end: '13:00' },
    ];
    const sorted = sortBlocks(blocks);
    expect(sorted.map((b) => b.start)).toEqual(['09:00', '14:00']);
    expect(blocks[0].start).toBe('14:00'); // original intacto
  });
});

describe('clampBusinessHours', () => {
  it('devuelve el default si no hay nada guardado', () => {
    expect(clampBusinessHours(undefined)).toEqual(DEFAULT_BUSINESS_HOURS);
    expect(clampBusinessHours('garbage')).toEqual(DEFAULT_BUSINESS_HOURS);
  });

  it('descarta bloques inválidos en vez de fallar entero', () => {
    const result = clampBusinessHours({
      enabled: true,
      days: {
        '1': { enabled: true, blocks: [{ start: '09:00', end: '13:00' }, { start: '25:99', end: '10:00' }] },
      },
    });
    expect(result.days['1'].blocks).toEqual([{ start: '09:00', end: '13:00' }]);
    // Días no presentes en el input se completan con el default de ese día.
    expect(result.days['6']).toEqual(DEFAULT_BUSINESS_HOURS.days['6']);
  });

  it('ordena los bloques de cada día', () => {
    const result = clampBusinessHours({
      days: {
        '5': {
          enabled: true,
          blocks: [
            { start: '14:00', end: '18:00' },
            { start: '09:00', end: '12:00' },
          ],
        },
      },
    });
    expect(result.days['5'].blocks.map((b) => b.start)).toEqual(['09:00', '14:00']);
  });
});

describe('firstBlockStart', () => {
  it('null si la feature está apagada', () => {
    expect(firstBlockStart({ ...ENABLED_MON_FRI, enabled: false }, '1')).toBeNull();
  });

  it('null si el día está apagado o sin bloques', () => {
    expect(firstBlockStart(ENABLED_MON_FRI, '6')).toBeNull(); // sábado, apagado por default
  });

  it('la hora del primer bloque (aunque no venga ordenado)', () => {
    const settings = setDayEnabled(ENABLED_MON_FRI, '5', true);
    const withBlocks: BusinessHoursSettings = {
      ...settings,
      days: {
        ...settings.days,
        '5': { enabled: true, blocks: [{ start: '14:00', end: '18:00' }, { start: '09:00', end: '12:00' }] },
      },
    };
    expect(firstBlockStart(withBlocks, '5')).toBe('09:00');
  });

  it('viernes de jornada reducida: un solo bloque hasta el mediodía', () => {
    const settings: BusinessHoursSettings = {
      ...ENABLED_MON_FRI,
      days: { ...ENABLED_MON_FRI.days, '5': { enabled: true, blocks: [{ start: '09:00', end: '12:00' }] } },
    };
    expect(firstBlockStart(settings, '5')).toBe('09:00');
  });
});

describe('isoWeekdayOf', () => {
  it('lunes → "1", domingo → "7"', () => {
    expect(isoWeekdayOf('2026-09-14')).toBe('1'); // lunes
    expect(isoWeekdayOf('2026-09-18')).toBe('5'); // viernes
    expect(isoWeekdayOf('2026-09-20')).toBe('7'); // domingo
  });
});

describe('mutaciones puras', () => {
  it('setFeatureEnabled / setDayEnabled solo tocan el flag pedido', () => {
    const withFeature = setFeatureEnabled(DEFAULT_BUSINESS_HOURS, true);
    expect(withFeature.enabled).toBe(true);
    expect(withFeature.days).toBe(DEFAULT_BUSINESS_HOURS.days);

    const withDay = setDayEnabled(DEFAULT_BUSINESS_HOURS, '6', true);
    expect(withDay.days['6'].enabled).toBe(true);
    expect(withDay.days['1']).toBe(DEFAULT_BUSINESS_HOURS.days['1']);
  });

  it('addBlock agrega un bloque de 1h a continuación del último', () => {
    const settings: BusinessHoursSettings = {
      ...DEFAULT_BUSINESS_HOURS,
      days: { ...DEFAULT_BUSINESS_HOURS.days, '6': { enabled: true, blocks: [] } },
    };
    const next = addBlock(settings, '6');
    expect(next.days['6'].blocks).toEqual([{ start: '09:00', end: '10:00' }]);

    const withSecond = addBlock(next, '6');
    expect(withSecond.days['6'].blocks).toEqual([
      { start: '09:00', end: '10:00' },
      { start: '10:00', end: '11:00' },
    ]);
  });

  it('removeBlock saca el bloque por índice', () => {
    const settings: BusinessHoursSettings = {
      ...DEFAULT_BUSINESS_HOURS,
      days: {
        ...DEFAULT_BUSINESS_HOURS.days,
        '1': { enabled: true, blocks: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }] },
      },
    };
    const next = removeBlock(settings, '1', 0);
    expect(next.days['1'].blocks).toEqual([{ start: '14:00', end: '18:00' }]);
  });

  it('updateBlock mergea un patch en el bloque por índice', () => {
    const settings: BusinessHoursSettings = {
      ...DEFAULT_BUSINESS_HOURS,
      days: { ...DEFAULT_BUSINESS_HOURS.days, '1': { enabled: true, blocks: [{ start: '09:00', end: '13:00' }] } },
    };
    const next = updateBlock(settings, '1', 0, { end: '12:00' });
    expect(next.days['1'].blocks).toEqual([{ start: '09:00', end: '12:00' }]);
  });

  it('copyToWeekdays replica el día elegido en Lun-Vie sin tocar sábado/domingo', () => {
    const settings: BusinessHoursSettings = {
      ...DEFAULT_BUSINESS_HOURS,
      days: { ...DEFAULT_BUSINESS_HOURS.days, '5': { enabled: true, blocks: [{ start: '09:00', end: '12:00' }] } },
    };
    const next = copyToWeekdays(settings, '5');
    for (const key of ['1', '2', '3', '4'] as const) {
      expect(next.days[key].blocks).toEqual([{ start: '09:00', end: '12:00' }]);
    }
    expect(next.days['6']).toBe(settings.days['6']); // fin de semana intacto
  });
});
