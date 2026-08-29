import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  notificationPermission,
  notificationsSupported,
  notifyPhaseChange,
} from './notify';

class MockNotification {
  static permission: NotificationPermission = 'granted';
  static instances: { title: string; options?: NotificationOptions }[] = [];
  constructor(
    public title: string,
    public options?: NotificationOptions
  ) {
    MockNotification.instances.push({ title, options });
  }
}

describe('sin soporte de Notification (ej. Safari en iOS fuera de PWA)', () => {
  it('notificationsSupported = false y notifyPhaseChange no explota', () => {
    expect(notificationsSupported()).toBe(false);
    expect(notificationPermission()).toBe('unsupported');
    expect(() => notifyPhaseChange('work-done')).not.toThrow();
  });
});

describe('con soporte de Notification', () => {
  beforeEach(() => {
    MockNotification.instances = [];
    MockNotification.permission = 'granted';
    vi.stubGlobal('Notification', MockNotification);
    vi.stubGlobal('window', { Notification: MockNotification });
    vi.stubGlobal('document', { hidden: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('con permiso y pestaña oculta, dispara la notificación del cambio de fase', () => {
    notifyPhaseChange('work-done');
    expect(MockNotification.instances).toHaveLength(1);
    expect(MockNotification.instances[0].title).toBe('pomotion');
    expect(MockNotification.instances[0].options?.body).toMatch(/pomodoro/i);
    expect(MockNotification.instances[0].options?.tag).toBe('pomotion-phase');

    notifyPhaseChange('break-done');
    expect(MockNotification.instances[1].options?.body).toMatch(/descanso/i);
  });

  it('no dispara si la pestaña está visible', () => {
    vi.stubGlobal('document', { hidden: false });
    notifyPhaseChange('work-done');
    expect(MockNotification.instances).toHaveLength(0);
  });

  it('no dispara si el permiso no está concedido', () => {
    MockNotification.permission = 'denied';
    notifyPhaseChange('work-done');
    expect(MockNotification.instances).toHaveLength(0);

    MockNotification.permission = 'default';
    notifyPhaseChange('work-done');
    expect(MockNotification.instances).toHaveLength(0);
  });

  it('notificationPermission refleja el estado del navegador', () => {
    expect(notificationPermission()).toBe('granted');
    MockNotification.permission = 'denied';
    expect(notificationPermission()).toBe('denied');
  });
});
