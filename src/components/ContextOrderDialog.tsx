import { useEffect, useState } from 'react';
import { moveItem, orderFiles } from '../fileOrder';
import { useT } from '../i18n';
import type { FileEntry } from '../types';

/**
 * Reordenar las pestañas de contexto (Trabajo / Casa / …). El orden se
 * guarda en localStorage (`useFileOrder`) y no toca el server.
 */
export default function ContextOrderDialog({
  files,
  order,
  onSave,
  onClose,
}: {
  /** Contextos ya ordenados (como se ven en las pestañas). */
  files: FileEntry[];
  order: string[];
  onSave: (order: string[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [items, setItems] = useState<FileEntry[]>(() => orderFiles(files, order));

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function move(from: number, to: number) {
    const next = moveItem(items, from, to);
    setItems(next);
    onSave(next.map((f) => f.id));
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="context-order-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="context-order-title">{t('contextOrder.title')}</h2>
        <p>{t('contextOrder.body')}</p>

        <ul className="context-order-list">
          {items.map((file, i) => (
            <li key={file.id}>
              <span className="context-order-name">{file.label}</span>
              <div className="context-order-actions">
                <button
                  type="button"
                  className="btn btn-icon"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  aria-label={t('contextOrder.up', { name: file.label })}
                  title={t('contextOrder.up', { name: file.label })}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-icon"
                  onClick={() => move(i, i + 1)}
                  disabled={i === items.length - 1}
                  aria-label={t('contextOrder.down', { name: file.label })}
                  title={t('contextOrder.down', { name: file.label })}
                >
                  ↓
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="sheet-actions">
          <button type="button" className="btn btn-filled" onClick={onClose}>
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  );
}
