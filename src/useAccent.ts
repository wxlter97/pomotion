import { useCallback, useEffect, useState } from 'react';
import {
  contrastColorFor,
  DEFAULT_ACCENT,
  DEFAULT_CUSTOM_COLOR,
  isAccent,
  isHexColor,
  type Accent,
} from './accent';

const KEY = 'pomotion:accent';
const CUSTOM_KEY = 'pomotion:accent-custom-color';

function readStored(): Accent {
  try {
    const stored = localStorage.getItem(KEY);
    return isAccent(stored) ? stored : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

function readStoredCustomColor(): string {
  try {
    const stored = localStorage.getItem(CUSTOM_KEY);
    return isHexColor(stored) ? stored : DEFAULT_CUSTOM_COLOR;
  } catch {
    return DEFAULT_CUSTOM_COLOR;
  }
}

/**
 * Acento de color activo + setter (persiste en localStorage y en
 * `data-accent`). Con accent === 'custom', el color elegido con el picker
 * (`customColor`) se aplica como `--color-accent`/`--color-accent-contrast`
 * inline sobre <html> — los bloques CSS de los presets no aplican ahí.
 */
export function useAccent(): [Accent, (next: Accent) => void, string, (hex: string) => void] {
  const [accent, setAccent] = useState<Accent>(readStored);
  const [customColor, setCustomColorState] = useState<string>(readStoredCustomColor);

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    const style = document.documentElement.style;
    if (accent === 'custom') {
      style.setProperty('--color-accent', customColor);
      style.setProperty('--color-accent-contrast', contrastColorFor(customColor));
    } else {
      style.removeProperty('--color-accent');
      style.removeProperty('--color-accent-contrast');
    }
  }, [accent, customColor]);

  const choose = useCallback((next: Accent) => {
    setAccent(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // localStorage no disponible — el cambio vale para esta sesión igual
    }
  }, []);

  const setCustomColor = useCallback((hex: string) => {
    if (!isHexColor(hex)) return;
    setCustomColorState(hex);
    try {
      localStorage.setItem(CUSTOM_KEY, hex);
    } catch {
      // localStorage no disponible — el cambio vale para esta sesión igual
    }
  }, []);

  return [accent, choose, customColor, setCustomColor];
}
