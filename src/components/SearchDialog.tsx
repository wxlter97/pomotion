import { useEffect, useMemo, useRef, useState } from 'react';
import { searchTasks, UnauthorizedError } from '../api';
import { shortDate } from '../taskMeta';
import type { TaskSearchResult } from '../types';

const DEBOUNCE_MS = 220;

/** "Lunes · 3 sep" / "Sin fecha" a partir del resultado. */
function whenLabel(r: TaskSearchResult): string {
  if (!r.date) return 'Sin fecha';
  const date = shortDate(r.date);
  return r.day ? `${r.day} · ${date}` : date;
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
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TaskSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
            ? 'La sesión expiró. Recargá la página para volver a entrar.'
            : err instanceof Error
              ? err.message
              : 'No se pudo buscar'
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
    if (trimmed.length === 0) return 'Escribí para buscar entre todas tus tareas.';
    if (loading) return null;
    return 'Ninguna tarea coincide.';
  }, [trimmed, loading]);

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--search"
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 id="search-title">Buscar tareas</h2>

        <input
          ref={inputRef}
          type="search"
          className="search-input"
          placeholder="Nombre de la tarea…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          aria-label="Texto a buscar"
        />

        {error && <p className="error">{error}</p>}

        {!error && emptyMessage && <p className="muted search-empty">{emptyMessage}</p>}

        {!error && results.length > 0 && (
          <ul className="search-results" ref={listRef} role="listbox" aria-label="Resultados">
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
                    {whenLabel(r)}
                    {showContext && r.file ? ` · ${r.file}` : ''}
                    {r.hasSessions ? ' · con tiempo' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="sheet-actions">
          <button type="button" className="btn btn-plain" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
