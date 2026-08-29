import { useCallback, useState } from 'react';
import { notificationPermission, requestNotificationPermission } from './notify';

const KEY = 'pomotion:notifications';

// Apagadas por defecto: necesitan un permiso explícito del navegador que
// solo se pide al activar el toggle.
function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function persist(value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? '1' : '0');
  } catch {
    // ignorar
  }
}

export type NotificationSetting = {
  /** Preferencia activa Y permiso concedido — lo que Timer.tsx debe mirar. */
  enabled: boolean;
  permission: NotificationPermission | 'unsupported';
  toggle: () => Promise<void>;
};

export function useNotificationSetting(): NotificationSetting {
  const [wanted, setWanted] = useState<boolean>(readStored);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    notificationPermission
  );

  const toggle = useCallback(async () => {
    if (wanted) {
      persist(false);
      setWanted(false);
      return;
    }
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === 'granted') {
      persist(true);
      setWanted(true);
    }
  }, [wanted]);

  return { enabled: wanted && permission === 'granted', permission, toggle };
}
