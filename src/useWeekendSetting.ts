import { useCallback, useState } from 'react';

const KEY = 'pomotion:show-weekend';

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'; // oculto por defecto
  } catch {
    return false;
  }
}

/** "Mostrar sábado y domingo en la vista semanal". Ajuste solo-cliente: cambia
 *  el request (`?weekend=1`), el server agrega las columnas Sáb/Dom. */
export function useWeekendSetting(): [boolean, () => void] {
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
