import { useEffect, useRef, useState } from 'react';
import { saveDayNote, UnauthorizedError } from '../api';
import { useT } from '../i18n';

const COLLAPSED_KEY = 'pomotion:day-note-collapsed';
/** Coincide con el tope del backend. */
const MAX = 20000;

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) !== '0'; // plegado por defecto
  } catch {
    return true;
  }
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

/**
 * Bitácora del día: texto libre por día, aparte de las tareas. Cajón plegable
 * bajo el inbox. Guarda al perder el foco (o con ⌘/Ctrl+Enter) si cambió.
 * Se remonta al cambiar de día (App le pone `key={date}`).
 */
export default function DayNote({
  date,
  note,
  onSaved,
}: {
  date: string;
  note: string;
  onSaved: (date: string, body: string) => void;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [text, setText] = useState(note);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedRef = useRef(note);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // ignorar
    }
  }, [collapsed]);

  async function commit() {
    const next = text.trim();
    if (next === savedRef.current) return;
    setSaving(true);
    setError(null);
    try {
      const res = await saveDayNote(date, next);
      savedRef.current = res.body;
      setText(res.body);
      onSaved(date, res.body);
    } catch (err) {
      setError(
        err instanceof UnauthorizedError
          ? t('common.sessionExpired')
          : err instanceof Error
            ? err.message
            : t('dayNote.error')
      );
    } finally {
      setSaving(false);
    }
  }

  const hasNote = savedRef.current.trim().length > 0;

  return (
    <section className={collapsed ? 'day-note' : 'day-note is-open'}>
      <button
        type="button"
        className="inbox-header"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <ChevronIcon />
        <span>{t('dayNote.title')}</span>
        {hasNote && <span className="day-note-dot" aria-label={t('dayNote.hasNote')} />}
        {saving && <span className="day-note-status">{t('dayNote.saving')}</span>}
      </button>

      {!collapsed && (
        <div className="day-note-body">
          <textarea
            className="task-notes-input"
            placeholder={t('dayNote.placeholder')}
            value={text}
            maxLength={MAX}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void commit();
              }
            }}
            disabled={saving}
            rows={4}
          />
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </section>
  );
}
