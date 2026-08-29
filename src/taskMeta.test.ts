import { describe, expect, it } from 'vitest';
import { daysBetween, dueChipLabel, dueLabel, isOverdue, priorityLabel, shortDate } from './taskMeta';

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
