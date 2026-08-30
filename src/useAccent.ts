import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_ACCENT, isAccent, type Accent } from './accent';

const KEY = 'pomotion:accent';

function readStored(): Accent {
  try {
    const stored = localStorage.getItem(KEY);
    return isAccent(stored) ? stored : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

/** Acento de color activo + setter (persiste en localStorage y en `data-accent`). */
export function useAccent(): [Accent, (next: Accent) => void] {
  const [accent, setAccent] = useState<Accent>(readStored);

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  const choose = useCallback((next: Accent) => {
    setAccent(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // localStorage no disponible — el cambio vale para esta sesión igual
    }
  }, []);

  return [accent, choose];
}
