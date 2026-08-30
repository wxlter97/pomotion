import { describe, expect, it } from 'vitest';
import { dueBannerText, dueNotificationBody } from './dueReminders';
import { makeT } from './i18n';
import type { DueReminder } from './types';

const today = '2026-08-29';
const t = makeT('es');
const r = (id: string, name: string, due: string): DueReminder => ({ id, name, due });

describe('dueBannerText', () => {
  it('una tarea usa el nombre', () => {
    expect(dueBannerText([r('1', 'A', '2026-08-20')], today, t)).toBe('«A» vence hoy o ya venció.');
  });

  it('varias', () => {
    expect(dueBannerText([r('1', 'A', '2026-08-20'), r('2', 'B', today)], today, t)).toBe(
      '2 tareas vencen hoy o ya vencieron.'
    );
  });

  it('vacío → ""', () => {
    expect(dueBannerText([], today, t)).toBe('');
  });
});

describe('dueNotificationBody', () => {
  it('una tarea', () => {
    expect(dueNotificationBody([r('1', 'Enviar factura', '2026-08-20')], t)).toBe(
      '«Enviar factura» vence hoy o ya venció.'
    );
  });

  it('varias, recorta a 3', () => {
    expect(
      dueNotificationBody([r('1', 'A', today), r('2', 'B', today), r('3', 'C', today)], t)
    ).toBe('3 tareas: A, B, C.');
    expect(
      dueNotificationBody(
        [r('1', 'A', today), r('2', 'B', today), r('3', 'C', today), r('4', 'D', today)],
        t
      )
    ).toBe('4 tareas: A, B, C…');
  });
});
