import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  dueChipLabel,
  dueLabel,
  estimateLabel,
  isOverdue,
  parseEstimateMinutes,
  priorityLabel,
  shortDate,
  taskAgeLabel,
  taskAgeTitle,
  taskTimeSummary,
} from './taskMeta';

describe('priorityLabel', () => {
  it('traduce los niveles y el null', () => {
    expect(priorityLabel('high')).toBe('Alta');
    expect(priorityLabel('med')).toBe('Media');
    expect(priorityLabel('low')).toBe('Baja');
    expect(priorityLabel(null)).toBe('Sin prioridad');
  });
});

describe('shortDate', () => {
  it('formatea "D mmm"', () => {
    expect(shortDate('2026-09-03')).toBe('3 sep');
    expect(shortDate('2026-01-01')).toBe('1 ene');
  });
});

describe('daysBetween', () => {
  it('cuenta días con signo, sin corrimiento de zona horaria', () => {
    expect(daysBetween('2026-08-29', '2026-08-29')).toBe(0);
    expect(daysBetween('2026-08-29', '2026-09-01')).toBe(3);
    expect(daysBetween('2026-09-01', '2026-08-29')).toBe(-3);
    // cruce de año
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });
});

describe('isOverdue', () => {
  it('solo si hay due, no está hecha y ya pasó', () => {
    expect(isOverdue('2026-08-28', false, '2026-08-29')).toBe(true);
    expect(isOverdue('2026-08-29', false, '2026-08-29')).toBe(false); // hoy no está vencida
    expect(isOverdue('2026-08-28', true, '2026-08-29')).toBe(false); // hecha
    expect(isOverdue(null, false, '2026-08-29')).toBe(false);
  });
});

describe('dueLabel', () => {
  it('usa relativos para hoy/ayer/mañana y fecha corta para el resto', () => {
    expect(dueLabel('2026-08-29', '2026-08-29')).toBe('vence hoy');
    expect(dueLabel('2026-08-30', '2026-08-29')).toBe('vence mañana');
    expect(dueLabel('2026-08-28', '2026-08-29')).toBe('venció ayer');
    expect(dueLabel('2026-09-05', '2026-08-29')).toBe('vence 5 sep');
    expect(dueLabel('2026-08-20', '2026-08-29')).toBe('venció 20 ago');
  });
});

describe('dueChipLabel', () => {
  it('es compacta, sin prefijo', () => {
    expect(dueChipLabel('2026-08-29', '2026-08-29')).toBe('hoy');
    expect(dueChipLabel('2026-08-30', '2026-08-29')).toBe('mañana');
    expect(dueChipLabel('2026-08-28', '2026-08-29')).toBe('ayer');
    expect(dueChipLabel('2026-09-05', '2026-08-29')).toBe('5 sep');
  });
});

describe('parseEstimateMinutes', () => {
  it('interpreta número plano como minutos y formato Jira', () => {
    expect(parseEstimateMinutes('90')).toBe(90);
    expect(parseEstimateMinutes('1h 30m')).toBe(90);
    expect(parseEstimateMinutes('2h')).toBe(120);
    expect(parseEstimateMinutes('  45 ')).toBe(45);
  });

  it('devuelve null para vacío / basura / cero', () => {
    expect(parseEstimateMinutes('')).toBeNull();
    expect(parseEstimateMinutes('   ')).toBeNull();
    expect(parseEstimateMinutes('luego')).toBeNull();
    expect(parseEstimateMinutes('0')).toBeNull();
  });
});

describe('estimateLabel', () => {
  it('formatea minutos y trata null como vacío', () => {
    expect(estimateLabel(90)).toBe('1h 30m');
    expect(estimateLabel(30)).toBe('30m');
    expect(estimateLabel(null)).toBe('');
  });
});

describe('taskTimeSummary', () => {
  it('sin estimación: solo lo registrado, o null si no hay nada', () => {
    expect(taskTimeSummary(0, null)).toBeNull();
    expect(taskTimeSummary(1500, null)).toEqual({ text: '25m', over: false });
  });

  it('con estimación y algo registrado: "registrado / estimado"', () => {
    expect(taskTimeSummary(3600, 120)).toEqual({ text: '1h / 2h', over: false });
  });

  it('con estimación y nada registrado: "est. X"', () => {
    expect(taskTimeSummary(0, 120)).toEqual({ text: 'est. 2h', over: false });
  });

  it('marca over cuando lo registrado pasa la estimación', () => {
    expect(taskTimeSummary(9000, 120)).toEqual({ text: '2h 30m / 2h', over: true });
  });
});

describe('taskAgeLabel', () => {
  const today = '2026-08-29';

  it('null antes del umbral', () => {
    expect(taskAgeLabel('2026-08-29T10:00:00Z', today)).toBeNull();
    expect(taskAgeLabel('2026-08-24T10:00:00Z', today)).toBeNull(); // 5 días
  });

  it('días hasta las 2 semanas', () => {
    expect(taskAgeLabel('2026-08-22T08:00:00Z', today)).toBe('7d');
    expect(taskAgeLabel('2026-08-17T23:00:00Z', today)).toBe('12d');
  });

  it('semanas a partir de 14 días', () => {
    expect(taskAgeLabel('2026-08-15T00:00:00Z', today)).toBe('2sem'); // 14 días
    expect(taskAgeLabel('2026-07-25T00:00:00Z', today)).toBe('5sem'); // 35 días
  });

  it('taskAgeTitle da el texto largo', () => {
    expect(taskAgeTitle('2026-08-22T00:00:00Z', today)).toBe('Abierta hace 7 días');
    expect(taskAgeTitle('2026-08-28T00:00:00Z', today)).toBe('Abierta hace 1 día');
  });
});
