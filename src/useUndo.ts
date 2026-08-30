import { useCallback, useEffect, useRef, useState } from 'react';

export type UndoOffer = { id: number; message: string; run: () => void };

const UNDO_WINDOW_MS = 6000;

/**
 * Snackbar "Deshacer" genérico (ROADMAP §11 Tier 4): una sola acción
 * pendiente a la vez — ofrecer una nueva reemplaza a la anterior, así no
 * hay que apilar. Puro cliente, estado efímero (no persiste).
 */
export function useUndo(windowMs: number = UNDO_WINDOW_MS) {
  const [pending, setPending] = useState<UndoOffer | null>(null);
  const timerRef = useRef<number | null>(null);
  const nextId = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const offer = useCallback(
    (message: string, run: () => void) => {
      clearTimer();
      nextId.current += 1;
      setPending({ id: nextId.current, message, run });
      timerRef.current = window.setTimeout(() => setPending(null), windowMs);
    },
    [clearTimer, windowMs]
  );

  const dismiss = useCallback(() => {
    clearTimer();
    setPending(null);
  }, [clearTimer]);

  const trigger = useCallback(() => {
    clearTimer();
    setPending((cur) => {
      cur?.run();
      return null;
    });
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return { pending, windowMs, offer, dismiss, trigger };
}
