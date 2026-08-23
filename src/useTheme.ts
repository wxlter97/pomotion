import { useCallback, useEffect, useState } from 'react';
import type { Theme } from './types';

const KEY = 'pomotion:theme';

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme() ?? (systemPrefersDark() ? 'dark' : 'light'));

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Si el usuario nunca eligió manualmente, seguir el tema del sistema.
  useEffect(() => {
    if (readStoredTheme()) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // ignorar
      }
      return next;
    });
  }, []);

  return [theme, toggle];
}
