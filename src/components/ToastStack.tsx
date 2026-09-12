import DismissibleBanner from './DismissibleBanner';
import type { Toast } from '../useToasts';

/**
 * Pila de toasts fija en pantalla (arriba, centrada) — reemplaza al viejo
 * banner que quedaba pegado en su lugar del documento y se perdía de vista
 * al scrollear. Cada fila es un DismissibleBanner (mismo fade y auto-cierre);
 * `onDismissed` la saca de la pila cuando termina de desvanecerse.
 */
export default function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <DismissibleBanner
          key={toast.id}
          tone={toast.tone}
          message={toast.message}
          onDismissed={() => onDismiss(toast.id)}
        />
      ))}
    </div>
  );
}
