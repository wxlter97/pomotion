import { useCallback, useState } from 'react';

const KEY = 'pomotion:timer-enabled';

function readStored(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === null ? true : stored === '1'; // timer activado por defecto
  } catch {
    return true;
  }
}

/**
 * ¿Se muestra el timer (Pomodoro/Libre) en "Hoy"? Con `false` desaparece
 * el timer entero — el registro de tiempo sigue siendo posible a mano vía
 * "Agregar sesión" en cada tarea. 100% cliente (localStorage).
 */
export function useTimerEnabledSetting(): [boolean, () => void] {
  const [enabled, setEnabled] = useState<boolean>(readStored);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(KEY, next ? '1' : '0');
      } catch {
        // ignorar
      }
      return next;
    });
  }, []);

  return [enabled, toggle];
}
