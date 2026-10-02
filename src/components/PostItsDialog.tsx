import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPostIt, deletePostIt, getPostIts, updatePostIt, UnauthorizedError } from '../api';
import { TAG_COLORS, tagColorOf, type TagColor } from '../tags';
import type { PostIt } from '../types';
import ConfirmDialog from './ConfirmDialog';
import { useT, type MsgKey, type TFn } from '../i18n';

const TITLE_MAX = 120;
/** Coincide con el tope del backend. */
const BODY_MAX = 20000;
/** El tamaño solo se aplica y se guarda en pantallas anchas: en el celular
 *  la nota ocupa el ancho disponible y no hay manija de arrastre. Mismo
 *  corte que el CSS (`.post-it`). */
const RESIZABLE_QUERY = '(min-width: 721px)';
/** Espera a que el usuario suelte la manija antes de guardar. */
const RESIZE_SAVE_DELAY_MS = 500;

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
  onResize,
  onDelete,
}: {
  postIt: PostIt;
  autoFocusBody: boolean;
  busy: boolean;
  colorLabel: (key: TagColor) => string;
  t: TFn;
  onSave: (id: string, fields: { title?: string; body?: string; color?: string; pinned?: boolean }) => Promise<void>;
  onResize: (id: string, width: number, height: number) => void;
  onDelete: (postIt: PostIt) => void;
}) {
  const [title, setTitle] = useState(postIt.title);
  const [body, setBody] = useState(postIt.body);
  const savedRef = useRef({ title: postIt.title, body: postIt.body });
  const cardRef = useRef<HTMLLIElement>(null);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  // El navegador cambia el tamaño de la tarjeta al arrastrar la esquina
  // (`resize: both`); acá solo lo detectamos y lo guardamos, sin pasar por
  // `busy`/recarga para no quitarle el foco al texto. Se compara contra el
  // tamaño medido al montar (ya con el guardado aplicado por CSS), así que
  // un tamaño por defecto o recortado por el contenedor nunca se persiste
  // salvo que el usuario lo mueva. Un redimensionado de la ventana también
  // cambia el tamaño medido, por eso se ignora si acaba de ocurrir.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let baseline = { w: el.offsetWidth, h: el.offsetHeight };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastWindowResize = 0;
    const onWindowResize = () => {
      lastWindowResize = Date.now();
    };
    window.addEventListener('resize', onWindowResize);

    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!window.matchMedia(RESIZABLE_QUERY).matches) return;
        const w = Math.round(el.offsetWidth);
        const h = Math.round(el.offsetHeight);
        if (Date.now() - lastWindowResize < RESIZE_SAVE_DELAY_MS * 2) {
          baseline = { w, h };
          return;
        }
        if (Math.abs(w - baseline.w) < 2 && Math.abs(h - baseline.h) < 2) return;
        baseline = { w, h };
        onResizeRef.current(postIt.id, w, h);
      }, RESIZE_SAVE_DELAY_MS);
    });
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('resize', onWindowResize);
    };
  }, [postIt.id]);

  const sizeVars = {
    ...(postIt.width != null ? { '--pi-w': `${postIt.width}px` } : {}),
    ...(postIt.height != null ? { '--pi-h': `${postIt.height}px` } : {}),
  } as CSSProperties;

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
    <li ref={cardRef} className="post-it" data-tag-color={tagColorOf(postIt.color)} style={sizeVars}>
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

/** Contenido del tablero: toolbar de "+ nueva" + tarjetas + errores. Sin
 *  chrome propio (ni modal ni cabecera) para poder montarse tanto dentro del
 *  diálogo de Ajustes (`PostItsDialog`) como inline en la pantalla principal
 *  (`PostItsPanel`). `onRequestClose`, si viene, se llama con Escape —
 *  salvo que haya una confirmación de borrado abierta, que se cierra primero. */
function PostItsBoard({ onRequestClose }: { onRequestClose?: () => void }) {
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
    if (!onRequestClose) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pendingDelete) onRequestClose!();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onRequestClose, pendingDelete]);

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

  /** Guarda el tamaño sin recargar ni bloquear la UI; el estado local se
   *  actualiza a mano para que coincida con lo guardado. */
  function saveSize(id: string, width: number, height: number) {
    setPostIts((prev) => prev.map((p) => (p.id === id ? { ...p, width, height } : p)));
    updatePostIt(id, { width, height }).catch((err) => setError(errText(err, t)));
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const p = pendingDelete;
    setPendingDelete(null);
    await run(() => deletePostIt(p.id));
  }

  return (
    <>
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
              onResize={saveSize}
              onDelete={setPendingDelete}
            />
          ))}
        </ul>
      )}

      {error && <p className="error">{error}</p>}

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
    </>
  );
}

const PANEL_COLLAPSED_KEY = 'pomotion:post-its-collapsed';

function readPanelCollapsed(): boolean {
  try {
    return localStorage.getItem(PANEL_COLLAPSED_KEY) === '1'; // abierto por defecto
  } catch {
    return false;
  }
}

/** Post-its "a mano" en la pantalla principal: mismo cajón plegable que
 *  `DayNote`, pero abierto por defecto — a diferencia de la bitácora, un
 *  post-it real siempre está a la vista. */
export function PostItsPanel() {
  const t = useT();
  const [collapsed, setCollapsed] = useState(readPanelCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // ignorar
    }
  }, [collapsed]);

  return (
    <section className={collapsed ? 'day-note' : 'day-note is-open'}>
      <button
        type="button"
        className="inbox-header"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <ChevronIcon />
        <span>{t('postIts.title')}</span>
      </button>

      {!collapsed && (
        <div className="day-note-body">
          <PostItsBoard />
        </div>
      )}
    </section>
  );
}

function ChevronIcon() {
  return (
    <svg
      className="inbox-chevron"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** Tablero de post-its en un diálogo de página completa: notas sueltas de
 *  texto libre, independientes del calendario. Se abre desde Ajustes, para
 *  quienes prefieren una vista más grande que el panel de la pantalla
 *  principal (`PostItsPanel`). */
export default function PostItsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();

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

        <PostItsBoard onRequestClose={onClose} />

        <div className="sheet-actions">
          <button type="button" className="btn btn-plain" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
