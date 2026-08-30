import { useT } from '../i18n';

/** Snackbar "Deshacer" (ver `useUndo`): mensaje + acción + barra de cuenta
 *  regresiva. `id` cambia con cada oferta para reiniciar la animación. */
export default function UndoSnackbar({
  id,
  message,
  windowMs,
  onUndo,
  onDismiss,
}: {
  id: number;
  message: string;
  windowMs: number;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div className="undo-snackbar" role="status">
      <span className="undo-snackbar-text">{message}</span>
      <button type="button" className="undo-snackbar-action" onClick={onUndo}>
        {t('undo.action')}
      </button>
      <button
        type="button"
        className="undo-snackbar-close"
        onClick={onDismiss}
        aria-label={t('common.close')}
        title={t('common.close')}
      >
        ×
      </button>
      <span key={id} className="undo-snackbar-bar" style={{ animationDuration: `${windowMs}ms` }} />
    </div>
  );
}
