import { useEffect, useState, type FormEvent } from 'react';
import { createTag, deleteTag, updateTag, UnauthorizedError } from '../api';
import { DEFAULT_TAG_COLOR, TAG_COLORS, tagColorOf, type TagColor } from '../tags';
import type { Tag } from '../types';
import ConfirmDialog from './ConfirmDialog';
import { useT, type MsgKey, type TFn } from '../i18n';

function errText(err: unknown, t: TFn): string {
  if (err instanceof UnauthorizedError) return t('goals.sessionExpired');
  return err instanceof Error ? err.message : t('common.somethingWrong');
}

function Swatches({
  value,
  onPick,
  disabled,
  label,
}: {
  value: TagColor;
  onPick: (c: TagColor) => void;
  disabled?: boolean;
  label: (key: TagColor) => string;
}) {
  return (
    <div className="tag-swatches">
      {TAG_COLORS.map((c) => (
        <button
          key={c.key}
          type="button"
          className={c.key === value ? 'tag-swatch is-active' : 'tag-swatch'}
          data-tag-color={c.key}
          onClick={() => onPick(c.key)}
          disabled={disabled}
          aria-label={label(c.key)}
          title={label(c.key)}
        />
      ))}
    </div>
  );
}

/** Alta / edición / borrado de etiquetas. Tras cualquier cambio llama a
 *  `onChanged` para que la app recargue la lista. */
export default function TagsDialog({
  tags,
  onChanged,
  onClose,
}: {
  tags: Tag[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const colorLabel = (key: TagColor) => t(`tags.color.${key}` as MsgKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<TagColor>(DEFAULT_TAG_COLOR);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const [pendingDelete, setPendingDelete] = useState<Tag | null>(null);

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
      onChanged();
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function submitNew(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    await run(async () => {
      await createTag(name, newColor);
      setNewName('');
      setNewColor(DEFAULT_TAG_COLOR);
    });
  }

  async function saveName(tag: Tag) {
    const name = editingName.trim();
    setEditingId(null);
    if (!name || name === tag.name) return;
    await run(() => updateTag(tag.id, { name }));
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const tag = pendingDelete;
    setPendingDelete(null);
    await run(() => deleteTag(tag.id));
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--tags"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tags-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="tags-title">{t('tags.title')}</h2>

        <form className="tag-new-form" onSubmit={submitNew}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('tags.newPlaceholder')}
            disabled={busy}
            maxLength={40}
          />
          <Swatches value={newColor} onPick={setNewColor} disabled={busy} label={colorLabel} />
          <button type="submit" className="btn btn-tinted btn-small" disabled={busy || !newName.trim()}>
            {t('common.add')}
          </button>
        </form>

        {tags.length === 0 ? (
          <p className="muted">{t('tags.none')}</p>
        ) : (
          <ul className="tag-manage-list">
            {tags.map((tag) => (
              <li key={tag.id} className="tag-manage-item">
                <span className="tag-dot" data-tag-color={tagColorOf(tag.color)} aria-hidden="true" />
                {editingId === tag.id ? (
                  <input
                    type="text"
                    className="tag-rename-input"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => void saveName(tag)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void saveName(tag);
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
                    className="tag-manage-name"
                    onClick={() => {
                      setEditingId(tag.id);
                      setEditingName(tag.name);
                    }}
                    title={t('common.rename')}
                  >
                    {tag.name}
                  </button>
                )}
                <Swatches
                  value={tagColorOf(tag.color)}
                  onPick={(c) => void run(() => updateTag(tag.id, { color: c }))}
                  disabled={busy}
                  label={colorLabel}
                />
                <button
                  type="button"
                  className="tag-manage-delete"
                  onClick={() => setPendingDelete(tag)}
                  disabled={busy}
                  aria-label={t('common.delete') + ' ' + tag.name}
                  title={t('tags.deleteTitle')}
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
          title={t('tags.deleteTitle')}
          message={t('tags.deleteBody')}
          confirmLabel={t('common.delete')}
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
