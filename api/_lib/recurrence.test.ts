import { describe, expect, it } from 'vitest';
import {
  isLastDayOfMonth,
  isoWeekday,
  isValidMonthdays,
  parseMonthdays,
  recurrenceSummary,
  ruleFiresOn,
  serializeMonthdays,
} from './recurrence.js';

describe('isoWeekday', () => {
  it('1=Lun .. 7=Dom', () => {
    expect(isoWeekday('2026-08-24')).toBe(1); // lunes
    expect(isoWeekday('2026-08-28')).toBe(5); // viernes
    expect(isoWeekday('2026-08-29')).toBe(6); // sábado
    expect(isoWeekday('2026-08-30')).toBe(7); // domingo
  });
});

describe('isLastDayOfMonth', () => {
  it('detecta fin de mes de 31, 30, febrero', () => {
    expect(isLastDayOfMonth('2026-08-31')).toBe(true);
    expect(isLastDayOfMonth('2026-08-30')).toBe(false);
    expect(isLastDayOfMonth('2026-04-30')).toBe(true);
    expect(isLastDayOfMonth('2026-02-28')).toBe(true); // 2026 no bisiesto
    expect(isLastDayOfMonth('2028-02-28')).toBe(false); // 2028 bisiesto
    expect(isLastDayOfMonth('2028-02-29')).toBe(true);
  });
});

describe('parseMonthdays / serialize / isValid', () => {
  it('ordena, desduplica y acepta -1', () => {
    expect(parseMonthdays('15,1,15,-1')).toEqual([-1, 1, 15]);
    expect(serializeMonthdays([15, 1, -1, 1])).toBe('-1,1,15');
  });
  it('rechaza fuera de rango / no enteros / vacío', () => {
    expect(parseMonthdays('0')).toEqual([]);
    expect(parseMonthdays('32')).toEqual([]);
    expect(parseMonthdays('1,x')).toEqual([]);
    expect(parseMonthdays('')).toEqual([]);
    expect(isValidMonthdays('1,15')).toBe(true);
    expect(isValidMonthdays('')).toBe(false);
    expect(isValidMonthdays('40')).toBe(false);
  });
});

describe('ruleFiresOn — weekly', () => {
  const rule = { freq: 'weekly' as const, weekdays: '1,3,5', monthdays: '' };
  it('cae en los días marcados, no en los otros', () => {
    expect(ruleFiresOn(rule, '2026-08-24')).toBe(true); // lunes
    expect(ruleFiresOn(rule, '2026-08-25')).toBe(false); // martes
    expect(ruleFiresOn(rule, '2026-08-26')).toBe(true); // miércoles
  });
});

describe('ruleFiresOn — monthly', () => {
  it('cae el día del mes indicado', () => {
    const rule = { freq: 'monthly' as const, weekdays: '1,2,3,4,5', monthdays: '1,15' };
    expect(ruleFiresOn(rule, '2026-08-01')).toBe(true);
    expect(ruleFiresOn(rule, '2026-08-15')).toBe(true);
    expect(ruleFiresOn(rule, '2026-08-16')).toBe(false);
    // no le importa el día de semana
    expect(ruleFiresOn(rule, '2026-11-01')).toBe(true); // domingo
  });

  it('-1 = último día del mes, sea 28/30/31', () => {
    const rule = { freq: 'monthly' as const, weekdays: '', monthdays: '-1' };
    expect(ruleFiresOn(rule, '2026-08-31')).toBe(true);
    expect(ruleFiresOn(rule, '2026-08-30')).toBe(false);
    expect(ruleFiresOn(rule, '2026-02-28')).toBe(true);
    expect(ruleFiresOn(rule, '2026-04-30')).toBe(true);
  });

  it('día 31 no cae en meses de 30 (no se corre)', () => {
    const rule = { freq: 'monthly' as const, weekdays: '', monthdays: '31' };
    expect(ruleFiresOn(rule, '2026-08-31')).toBe(true);
    expect(ruleFiresOn(rule, '2026-09-30')).toBe(false);
  });

  it('monthdays vacío / inválido nunca cae', () => {
    expect(ruleFiresOn({ freq: 'monthly', weekdays: '', monthdays: '' }, '2026-08-01')).toBe(false);
  });
});

describe('recurrenceSummary', () => {
  it('weekly', () => {
    expect(recurrenceSummary({ freq: 'weekly', weekdays: '1,2,3,4,5', monthdays: '' })).toBe('Lun–Vie');
    expect(recurrenceSummary({ freq: 'weekly', weekdays: '1,3,5', monthdays: '' })).toBe('L X V');
  });
  it('monthly', () => {
    expect(recurrenceSummary({ freq: 'monthly', weekdays: '', monthdays: '1,15' })).toBe('día 1, día 15');
    expect(recurrenceSummary({ freq: 'monthly', weekdays: '', monthdays: '-1' })).toBe('último día');
  });
});
