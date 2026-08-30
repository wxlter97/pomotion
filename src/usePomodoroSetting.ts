import { useCallback, useState } from 'react';

const KEY = 'pomotion:pomodoro';

function readStored(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === null ? true : stored === '1'; // pomodoro activado por defecto
  } catch {
    return true;
  }
}

/**
 * ¿Se ofrece el modo Pomodoro? Con `false`, el timer queda solo en "Libre"
 * y desaparece el selector de modo. 100% cliente (localStorage).
 */
export function usePomodoroSetting(): [boolean, () => void] {
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
