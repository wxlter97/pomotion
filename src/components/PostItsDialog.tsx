import { useCallback, useEffect, useRef, useState } from 'react';
import { createPostIt, deletePostIt, getPostIts, updatePostIt, UnauthorizedError } from '../api';
import { TAG_COLORS, tagColorOf, type TagColor } from '../tags';
import type { PostIt } from '../types';
import ConfirmDialog from './ConfirmDialog';
import { useT, type MsgKey, type TFn } from '../i18n';

const TITLE_MAX = 120;
/** Coincide con el tope del backend. */
const BODY_MAX = 20000;

function errText(err: unknown, t: TFn): string {
  if (err instanceof UnauthorizedError) return t('postIts.sessionExpired');
  return err instanceof Error ? err.message : t('postIts.error');
}

function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M14.5 3.5l6 6-3.2 3.2-.9 4.8-2-2-4.4 4.4-1.4-1.4 4.4-4.4-2-2 4.8-.9 3.2-3.2-4.5-4.5z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
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

/** Una tarjeta: título + cuerpo con guardado al perder el foco (como
 *  DayNote), color y fijado con guardado inmediato. El estado local no se
 *  resincroniza con el prop en cada render — solo al montar — para no
 *  pisar lo que el usuario está tipeando cuando el resto de la lista
 *  recarga (ver DayNote.tsx). */
function PostItCard({
  postIt,
  autoFocusBody,
  busy,
  colorLabel,
  t,
  onSave,
  onDelete,
}: {
  postIt: PostIt;
  autoFocusBody: boolean;
  busy: boolean;
  colorLabel: (key: TagColor) => string;
  t: TFn;
  onSave: (id: string, fields: { title?: string; body?: string; color?: string; pinned?: boolean }) => Promise<void>;
  onDelete: (postIt: PostIt) => void;
}) {
  const [title, setTitle] = useState(postIt.title);
  const [body, setBody] = useState(postIt.body);
  const savedRef = useRef({ title: postIt.title, body: postIt.body });

  async function commit() {
    const nextTitle = title.trim();
    const nextBody = body;
    const fields: { title?: string; body?: string } = {};
    if (nextTitle !== savedRef.current.title) fields.title = nextTitle;
    if (nextBody !== savedRef.current.body) fields.body = nextBody;
    if (Object.keys(fields).length === 0) return;
    savedRef.current = { title: nextTitle, body: nextBody };
    await onSave(postIt.id, fields);
  }

  return (
    <li className="post-it" data-tag-color={tagColorOf(postIt.color)}>
      <div className="post-it-head">
        <input
          type="text"
          className="post-it-title-input"
          value={title}
          maxLength={TITLE_MAX}
          placeholder={t('postIts.titlePlaceholder')}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void commit()}
          disabled={busy}
        />
        <button
          type="button"
          className={postIt.pinned ? 'post-it-pin is-active' : 'post-it-pin'}
          onClick={() => void onSave(postIt.id, { pinned: !postIt.pinned })}
          disabled={busy}
          aria-label={postIt.pinned ? t('postIts.unpin') : t('postIts.pin')}
          title={postIt.pinned ? t('postIts.unpin') : t('postIts.pin')}
        >
          <PinIcon filled={postIt.pinned} />
        </button>
        <button
          type="button"
          className="post-it-delete"
          onClick={() => onDelete(postIt)}
          disabled={busy}
          aria-label={t('postIts.deleteAria')}
          title={t('postIts.deleteTitle')}
        >
          ×
        </button>
      </div>

      <textarea
        className="post-it-body-input"
        value={body}
        maxLength={BODY_MAX}
        placeholder={t('postIts.bodyPlaceholder')}
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => void commit()}
        disabled={busy}
        autoFocus={autoFocusBody}
        rows={4}
      />

      <Swatches
        value={tagColorOf(postIt.color)}
        onPick={(c) => void onSave(postIt.id, { color: c })}
        disabled={busy}
        label={colorLabel}
      />
    </li>
  );
}

/** Tablero de post-its: notas sueltas de texto libre, independientes del
 *  calendario. Se abre desde el menú Ver, igual que Metas / Etiquetas. */
export default function PostItsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const colorLabel = (key: TagColor) => t(`tags.color.${key}` as MsgKey);

  const [postIts, setPostIts] = useState<PostIt[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newestId, setNewestId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PostIt | null>(null);

  const reload = useCallback(async () => {
    try {
      setPostIts((await getPostIts()).postIts);
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pendingDelete) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, pendingDelete]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function addNew() {
    setBusy(true);
    setError(null);
    try {
      const { postIt } = await createPostIt();
      setNewestId(postIt.id);
      await reload();
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const p = pendingDelete;
    setPendingDelete(null);
    await run(() => deletePostIt(p.id));
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--post-its"
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-its-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="post-its-title">{t('postIts.title')}</h2>

        <div className="post-it-toolbar">
          <button type="button" className="btn btn-tinted btn-small" onClick={() => void addNew()} disabled={busy}>
            + {t('postIts.new')}
          </button>
        </div>

        {loading ? (
          <p className="muted">{t('common.loading')}</p>
        ) : postIts.length === 0 ? (
          <p className="muted">{t('postIts.none')}</p>
        ) : (
          <ul className="post-it-board">
            {postIts.map((p) => (
              <PostItCard
                key={p.id}
                postIt={p}
                autoFocusBody={p.id === newestId}
                busy={busy}
                colorLabel={colorLabel}
                t={t}
                onSave={(id, fields) => run(() => updatePostIt(id, fields))}
                onDelete={setPendingDelete}
              />
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
          title={t('postIts.deleteTitle')}
          message={t('postIts.deleteBody')}
          confirmLabel={t('common.delete')}
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
