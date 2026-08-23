import { useCallback, useState } from 'react';

const KEY = 'pomotion:sounds';

function readStored(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === null ? true : stored === '1'; // activados por defecto
  } catch {
    return true;
  }
}

export function useSoundSetting(): [boolean, () => void] {
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
