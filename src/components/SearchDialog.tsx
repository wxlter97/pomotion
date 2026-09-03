import { useEffect, useMemo, useRef, useState } from 'react';
import { searchTasks, UnauthorizedError } from '../api';
import { shortDate } from '../taskMeta';
import { localizeDay, useLang, useT, type Lang, type TFn } from '../i18n';
import type { TaskSearchResult } from '../types';

const DEBOUNCE_MS = 220;

function whenLabel(r: TaskSearchResult, t: TFn, lang: Lang): string {
  if (!r.date) return t('common.noDate');
  const date = shortDate(r.date, lang);
  return r.day ? `${localizeDay(r.day, lang)} · ${date}` : date;
}

export default function SearchDialog({
  fileId,
  showContext,
  onPick,
  onClose,
}: {
  fileId: string | null;
  /** Mostrar el contexto (Trabajo/Casa) de cada resultado. */
  showContext: boolean;
  onPick: (result: TaskSearchResult) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TaskSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length === 0) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await searchTasks(trimmed, fileId ?? undefined);
        if (cancelled) return;
        setResults(res.results);
        setActive(0);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof UnauthorizedError
            ? t('common.sessionExpired')
            : err instanceof Error
              ? err.message
              : t('search.error')
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [trimmed, fileId]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = results[active];
      if (picked) onPick(picked);
    }
  }

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const emptyMessage = useMemo(() => {
    if (trimmed.length === 0) return t('search.hint');
    if (loading) return null;
    return t('search.noResults');
  }, [trimmed, loading, t]);

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--search"
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        // Igual que QuickAddSheet: enfocar recién al terminar la animación
        // de entrada del .sheet, no en el mount — si el input se enfoca
        // mientras el sheet todavía está fuera de pantalla (slide-up en
        // mobile), el teclado no aparece.
        onAnimationEnd={() => inputRef.current?.focus()}
      >
        <h2 id="search-title">{t('search.title')}</h2>

        <input
          ref={inputRef}
          type="search"
          className="search-input"
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          aria-label={t('search.inputLabel')}
        />

        {error && <p className="error">{error}</p>}

        {!error && emptyMessage && <p className="muted search-empty">{emptyMessage}</p>}

        {!error && results.length > 0 && (
          <ul className="search-results" ref={listRef} role="listbox" aria-label={t('search.results')}>
            {results.map((r, i) => (
              <li key={r.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className="search-result"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onPick(r)}
                >
                  <span className={r.done ? 'search-result-name is-done' : 'search-result-name'}>
                    {r.name}
                  </span>
                  <span className="search-result-meta">
                    {whenLabel(r, t, lang)}
                    {showContext && r.file ? ` · ${r.file}` : ''}
                    {r.hasSessions ? t('search.withTime') : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="sheet-actions">
          <button type="button" className="btn btn-plain" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
