import { useCallback, useState } from 'react';

const KEY = 'pomotion:file-order';

/** Lee el orden de contextos guardado (lista de ids). Vacío si no hay nada. */
export function readFileOrder(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Orden preferido de los contextos (Trabajo/Casa/…) para las pestañas.
 * 100% cliente (localStorage). El orden real lo aplica `orderFiles`.
 */
export function useFileOrder(): [string[], (order: string[]) => void] {
  const [order, setOrder] = useState<string[]>(readFileOrder);

  const save = useCallback((next: string[]) => {
    setOrder(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // ignorar
    }
  }, []);

  return [order, save];
}
