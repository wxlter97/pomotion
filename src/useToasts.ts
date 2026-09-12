import { useCallback, useRef, useState } from 'react';

export type ToastTone = 'success' | 'warning' | 'error' | 'info';
export type Toast = { id: number; message: string; tone: ToastTone };

/**
 * Pila de notificaciones efímeras (toasts), fijas en pantalla — a
 * diferencia del viejo banner pegado arriba de la página, se ven sin
 * importar dónde estés scrolleado. Varias pueden convivir a la vez (a
 * diferencia de `useUndo`, que reemplaza la anterior).
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  /** Agrega un toast al tope de la pila; se saca solo al desvanecerse
   *  (ver DismissibleBanner) o al cerrarlo a mano. */
  const push = useCallback((message: string, tone: ToastTone = 'info') => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((prev) => [{ id, message, tone }, ...prev]);
    return id;
  }, []);

  return { toasts, push, dismiss };
}
