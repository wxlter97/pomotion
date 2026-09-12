import { useEffect, useState, type FormEvent } from 'react';
import { createContext, deleteContext, updateContext, UnauthorizedError } from '../api';
import type { ContextType, FileEntry } from '../types';
import ConfirmDialog from './ConfirmDialog';
import { useT, type TFn } from '../i18n';

function errText(err: unknown, t: TFn): string {
  if (err instanceof UnauthorizedError) return t('contexts.sessionExpired');
  return err instanceof Error ? err.message : t('common.somethingWrong');
}

function TypeToggle({
  value,
  onPick,
  disabled,
}: {
  value: ContextType;
  onPick: (t: ContextType) => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <div className="segmented-control context-type-toggle" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={value === 'task'}
        className={value === 'task' ? 'segment active' : 'segment'}
        onClick={() => onPick('task')}
        disabled={disabled}
      >
        {t('contexts.typeTask')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'habit'}
        className={value === 'habit' ? 'segment active' : 'segment'}
        onClick={() => onPick('habit')}
        disabled={disabled}
      >
        {t('contexts.typeHabit')}
      </button>
    </div>
  );
}

/** Crear / renombrar / cambiar el tipo / borrar contextos. Tras cualquier
 *  cambio llama a `onChanged` (o `onRenamed` si cambió el id) para que la
 *  app recargue la lista y, si hace falta, re-seleccione el contexto. */
export default function ManageContextsDialog({
  files,
  onRenamed,
  onChanged,
  onClose,
}: {
  files: FileEntry[];
  onRenamed: (oldId: string, newId: string) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState<ContextType>('task');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');

  const [pendingDelete, setPendingDelete] = useState<FileEntry | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !editingId && !pendingDelete) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, editingId, pendingDelete]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function submitNew(e: FormEvent) {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    await run(async () => {
      await createContext(label, newType);
      setNewLabel('');
      setNewType('task');
      onChanged();
    });
  }

  async function saveLabel(file: FileEntry) {
    const label = editingLabel.trim();
    setEditingId(null);
    if (!label || label === file.label) return;
    await run(async () => {
      await updateContext(file.id, { label });
      onRenamed(file.id, label);
    });
  }

  async function setType(file: FileEntry, type: ContextType) {
    if (type === file.type) return;
    await run(async () => {
      await updateContext(file.id, { type });
      onChanged();
    });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const file = pendingDelete;
    setPendingDelete(null);
    await run(async () => {
      await deleteContext(file.id);
      onChanged();
    });
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--contexts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contexts-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="contexts-title">{t('contexts.title')}</h2>
        <p className="muted">{t('contexts.intro')}</p>

        <form className="context-new-form" onSubmit={submitNew}>
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder={t('contexts.newLabelPlaceholder')}
            disabled={busy}
            maxLength={40}
          />
          <TypeToggle value={newType} onPick={setNewType} disabled={busy} />
          <button type="submit" className="btn btn-tinted btn-small" disabled={busy || !newLabel.trim()}>
            {t('common.add')}
          </button>
        </form>

        {files.length === 0 ? (
          <p className="muted">{t('contexts.none')}</p>
        ) : (
          <ul className="context-manage-list">
            {files.map((file) => (
              <li key={file.id} className="context-manage-item">
                {editingId === file.id ? (
                  <input
                    type="text"
                    className="context-rename-input"
                    value={editingLabel}
                    onChange={(e) => setEditingLabel(e.target.value)}
                    onBlur={() => void saveLabel(file)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void saveLabel(file);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setEditingId(null);
                      }
                    }}
                    disabled={busy}
                    autoFocus
                    maxLength={40}
                  />
                ) : (
                  <button
                    type="button"
                    className="context-manage-name"
                    onClick={() => {
                      setEditingId(file.id);
                      setEditingLabel(file.label);
                    }}
                    title={t('common.rename')}
                  >
                    {file.label}
                  </button>
                )}
                <TypeToggle value={file.type} onPick={(type) => void setType(file, type)} disabled={busy} />
                <button
                  type="button"
                  className="context-manage-delete"
                  onClick={() => setPendingDelete(file)}
                  disabled={busy}
                  aria-label={t('contexts.deleteAria', { name: file.label })}
                  title={t('contexts.deleteTitle')}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="error">{error}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn btn-plain" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={t('contexts.deleteTitle')}
          message={t('contexts.deleteBody', { name: pendingDelete.label })}
          confirmLabel={t('common.delete')}
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
