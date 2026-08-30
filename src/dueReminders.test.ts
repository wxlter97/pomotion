import { describe, expect, it } from 'vitest';
import { dueBannerText, dueNotificationBody } from './dueReminders';
import type { DueReminder } from './types';

const today = '2026-08-29';
const r = (id: string, name: string, due: string): DueReminder => ({ id, name, due });

describe('dueBannerText', () => {
  it('todas vencidas', () => {
    expect(dueBannerText([r('1', 'A', '2026-08-20')], today)).toBe('1 tarea vencida.');
    expect(dueBannerText([r('1', 'A', '2026-08-20'), r('2', 'B', '2026-08-28')], today)).toBe(
      '2 tareas vencidas.'
    );
  });

  it('todas vencen hoy', () => {
    expect(dueBannerText([r('1', 'A', today), r('2', 'B', today)], today)).toBe(
      '2 tareas vencen hoy.'
    );
  });

  it('mezcla de vencidas y de hoy', () => {
    expect(dueBannerText([r('1', 'A', '2026-08-20'), r('2', 'B', today)], today)).toBe(
      '2 tareas vencen hoy o ya vencieron.'
    );
  });

  it('vacío → ""', () => {
    expect(dueBannerText([], today)).toBe('');
  });
});

describe('dueNotificationBody', () => {
  it('una tarea', () => {
    expect(dueNotificationBody([r('1', 'Enviar factura', '2026-08-20')])).toBe(
      '«Enviar factura» vence hoy o ya venció.'
    );
  });

  it('varias, recorta a 3', () => {
    expect(
      dueNotificationBody([r('1', 'A', today), r('2', 'B', today), r('3', 'C', today)])
    ).toBe('3 tareas: A, B, C.');
    expect(
      dueNotificationBody([
        r('1', 'A', today),
        r('2', 'B', today),
        r('3', 'C', today),
        r('4', 'D', today),
      ])
    ).toBe('4 tareas: A, B, C…');
  });
});
