import { useCallback, useState } from 'react';

const KEY = 'pomotion:carry-over-auto';

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'; // desactivado por defecto
  } catch {
    return false;
  }
}

/** "Traer pendientes a hoy automáticamente al abrir la app". */
export function useCarryOverSetting(): [boolean, () => void] {
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
