import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  createCalendarFeed,
  deleteCalendarFeed,
  getCalendarFeeds,
  syncCalendarFeeds,
  updateCalendarFeed,
  UnauthorizedError,
} from '../api';
import type { CalendarFeed, FileEntry } from '../types';
import ConfirmDialog from './ConfirmDialog';

function errText(err: unknown): string {
  if (err instanceof UnauthorizedError) return 'La sesión expiró. Recargá la página.';
  return err instanceof Error ? err.message : 'Algo salió mal';
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 40);
  }
}

function syncLabel(feed: CalendarFeed): string {
  if (feed.lastError) return `Error: ${feed.lastError}`;
  if (!feed.lastSyncedAt) return 'Sin sincronizar todavía';
  const mins = Math.floor((Date.now() - new Date(feed.lastSyncedAt).getTime()) / 60_000);
  if (mins < 1) return 'Sincronizado recién';
  if (mins < 60) return `Sincronizado hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Sincronizado hace ${hrs} h`;
  return `Sincronizado hace ${Math.floor(hrs / 24)} días`;
}

const NO_FILE = '__none__';

export default function CalendarFeedsDialog({
  files,
  onChanged,
  onClose,
}: {
  files: FileEntry[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [feeds, setFeeds] = useState<CalendarFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CalendarFeed | null>(null);

  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [fileId, setFileId] = useState<string>(NO_FILE);

  const reload = useCallback(async () => {
    try {
      setFeeds((await getCalendarFeeds()).feeds);
    } catch (err) {
      setError(errText(err));
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

  async function submitNew(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const { feed } = await createCalendarFeed(
        name.trim() || 'Calendario',
        url.trim(),
        fileId === NO_FILE ? null : fileId
      );
      setUrl('');
      setName('');
      setFileId(NO_FILE);
      await syncCalendarFeeds(feed.id).catch(() => {});
      await reload();
      onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setAdding(false);
    }
  }

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await reload();
      onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const feed = pendingDelete;
    setPendingDelete(null);
    await run(feed.id, () => deleteCalendarFeed(feed.id));
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--feeds"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feeds-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="feeds-title">Calendarios</h2>
        <p className="muted feeds-intro">
          Pegá la URL de suscripción iCal de un calendario (Google: “Dirección secreta en
          formato iCal”). Sus eventos con hora aparecen como tareas y se mantienen al día.
        </p>

        <form className="feed-new" onSubmit={submitNew}>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://calendar.google.com/…/basic.ics"
            disabled={adding}
            className="feed-url-input"
            aria-label="URL del calendario"
            required
          />
          <div className="feed-new-row">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre"
              disabled={adding}
              className="feed-name-input"
              aria-label="Nombre del calendario"
            />
            {files.length > 0 && (
              <select
                value={fileId}
                onChange={(e) => setFileId(e.target.value)}
                disabled={adding}
                className="feed-file-select"
                aria-label="Contexto destino"
              >
                <option value={NO_FILE}>Sin contexto</option>
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            )}
            <button type="submit" className="btn btn-tinted btn-small" disabled={adding || !url.trim()}>
              {adding ? 'Agregando…' : 'Agregar'}
            </button>
          </div>
        </form>

        {loading ? (
          <p className="muted">Cargando…</p>
        ) : feeds.length === 0 ? (
          <p className="muted">Todavía no suscribiste ningún calendario.</p>
        ) : (
          <ul className="feed-list">
            {feeds.map((feed) => {
              const busy = busyId === feed.id;
              return (
                <li key={feed.id} className="feed-item" data-error={feed.lastError ? '' : undefined}>
                  <div className="feed-item-main">
                    <span className="feed-item-name">{feed.name}</span>
                    <span className="feed-item-sub">{hostOf(feed.url)}</span>
                    <span className="feed-item-sync">{syncLabel(feed)}</span>
                  </div>
                  <div className="feed-item-actions">
                    <label className="feed-toggle" title="Sincronizar este calendario">
                      <input
                        type="checkbox"
                        checked={feed.enabled}
                        disabled={busy}
                        onChange={(e) =>
                          void run(feed.id, () =>
                            updateCalendarFeed(feed.id, { enabled: e.target.checked })
                          )
                        }
                      />
                      <span>Activo</span>
                    </label>
                    <button
                      type="button"
                      className="btn btn-plain btn-small"
                      disabled={busy || !feed.enabled}
                      onClick={() => void run(feed.id, () => syncCalendarFeeds(feed.id))}
                    >
                      {busy ? '…' : 'Sincronizar'}
                    </button>
                    <button
                      type="button"
                      className="feed-item-delete"
                      disabled={busy}
                      onClick={() => setPendingDelete(feed)}
                      aria-label={`Eliminar ${feed.name}`}
                      title="Eliminar calendario"
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {error && <p className="error">{error}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn btn-plain" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={`Eliminar «${pendingDelete.name}»`}
          message="Se quitan las tareas de este calendario que no tengan tiempo registrado. Las que sí tienen sesiones quedan como tareas normales."
          confirmLabel="Eliminar"
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
