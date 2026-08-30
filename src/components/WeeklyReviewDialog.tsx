import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getWeeklyReview,
  moveTask,
  moveTaskToInbox,
  saveWeekFocus,
  updateTaskDone,
  UnauthorizedError,
} from '../api';
import { formatDurationLabel } from '../duration';
import { tagColorOf } from '../tags';
import type { ReviewTask, WeeklyReview } from '../types';

const STEPS = ['Resumen', 'Pendientes', 'Foco'] as const;

/** 'YYYY-MM-DD' + N días, sin corrimiento de zona. */
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** "7.5h" / "45m" / "—" para las barras. */
function compact(seconds: number): string {
  if (seconds <= 0) return '—';
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)}h`;
  return `${Math.round(seconds / 60)}m`;
}

function Bars({
  rows,
}: {
  rows: { key: string; label: string; seconds: number; color?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.seconds));
  return (
    <div className="wr-bars">
      {rows.map((r) => (
        <div className="wr-bar-row" key={r.key}>
          <span className="wr-bar-label" title={r.label}>
            {r.color && <span className="wr-bar-dot" data-tag-color={tagColorOf(r.color)} />}
            {r.label}
          </span>
          <div className="wr-bar-track">
            <div className="wr-bar-fill" style={{ width: `${Math.round((r.seconds / max) * 100)}%` }} />
          </div>
          <span className="wr-bar-value">{compact(r.seconds)}</span>
        </div>
      ))}
    </div>
  );
}

export default function WeeklyReviewDialog({
  initialWeek,
  onClose,
  onChanged,
}: {
  /** Semana a revisar al abrir (label "2026.08.24 - 2026.08.28"). */
  initialWeek: string;
  onClose: () => void;
  /** Se llama tras mover/completar una tarea pendiente (para refrescar la agenda). */
  onChanged: () => void;
}) {
  const [week, setWeek] = useState(initialWeek);
  const [data, setData] = useState<WeeklyReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [handled, setHandled] = useState<Record<string, 'done' | 'bumped' | 'backlog'>>({});
  const [focusText, setFocusText] = useState('');
  const [savingFocus, setSavingFocus] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const load = useCallback(async (w: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getWeeklyReview(w);
      setData(res);
      setFocusText(res.nextFocus);
      setHandled({});
      setStep(0);
    } catch (err) {
      setError(
        err instanceof UnauthorizedError
          ? 'La sesión expiró. Recargá la página para volver a entrar.'
          : err instanceof Error
            ? err.message
            : 'No se pudo cargar la revisión'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(week);
  }, [load, week]);

  async function act(task: ReviewTask, how: 'done' | 'bumped' | 'backlog') {
    if (busyId) return;
    setBusyId(task.id);
    setError(null);
    try {
      if (how === 'done') await updateTaskDone(task.id, true);
      else if (how === 'bumped') await moveTask(task.id, { date: addDays(task.date, 7) });
      else await moveTaskToInbox(task.id);
      setHandled((prev) => ({ ...prev, [task.id]: how }));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la tarea');
    } finally {
      setBusyId(null);
    }
  }

  async function finish() {
    if (!data) return;
    setSavingFocus(true);
    setError(null);
    try {
      await saveWeekFocus(data.nextWeekStart, focusText);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el foco');
      setSavingFocus(false);
    }
  }

  const pending = useMemo(
    () => (data ? data.unfinished.filter((t) => !handled[t.id]) : []),
    [data, handled]
  );
  const resolvedCount = data ? data.unfinished.length - pending.length : 0;

  const deltaPct =
    data && data.previousLoggedSeconds > 0
      ? Math.round(((data.loggedSeconds - data.previousLoggedSeconds) / data.previousLoggedSeconds) * 100)
      : null;

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--analytics"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wr-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="wr-title">Revisión semanal</h2>

        <div className="wr-weeknav">
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => data && setWeek(data.previousWeekLabel)}
            disabled={loading || !data}
            aria-label="Semana anterior"
          >
            ‹
          </button>
          <span className="wr-weeknav-label">{data?.week ?? week}</span>
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => data && setWeek(data.nextWeekLabel)}
            disabled={loading || !data}
            aria-label="Semana siguiente"
          >
            ›
          </button>
        </div>

        <div className="segmented wr-steps">
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              className={i === step ? 'is-active' : undefined}
              onClick={() => setStep(i)}
              disabled={loading || !data}
            >
              {i + 1}. {label}
            </button>
          ))}
        </div>

        {error && <p className="error">{error}</p>}
        {loading && <p className="muted">Cargando…</p>}

        {data && !loading && (
          <div className="wr-body">
            {step === 0 && (
              <>
                <div className="wr-stats">
                  <div className="wr-stat">
                    <span className="wr-stat-value">
                      {data.completedCount}
                      <span className="wr-stat-of">/{data.totalCount}</span>
                    </span>
                    <span className="wr-stat-label">tareas hechas</span>
                  </div>
                  <div className="wr-stat">
                    <span className="wr-stat-value">{formatDurationLabel(data.loggedSeconds)}</span>
                    <span className="wr-stat-label">
                      registrado
                      {deltaPct !== null && deltaPct !== 0 && (
                        <span className={deltaPct > 0 ? 'wr-delta is-up' : 'wr-delta is-down'}>
                          {deltaPct > 0 ? '▲' : '▼'} {Math.abs(deltaPct)}%
                        </span>
                      )}
                    </span>
                  </div>
                </div>

                {data.loggedSeconds === 0 ? (
                  <p className="muted">Sin tiempo registrado esta semana.</p>
                ) : (
                  <>
                    {data.byContext.length > 0 && (
                      <section className="wr-section">
                        <h3>Por contexto</h3>
                        <Bars
                          rows={data.byContext.map((c) => ({
                            key: c.label,
                            label: c.label,
                            seconds: c.seconds,
                          }))}
                        />
                      </section>
                    )}
                    {data.byTag.length > 0 && (
                      <section className="wr-section">
                        <h3>Por etiqueta</h3>
                        <Bars
                          rows={data.byTag.map((t) => ({
                            key: t.tagId,
                            label: t.name,
                            seconds: t.seconds,
                            color: t.color,
                          }))}
                        />
                      </section>
                    )}
                  </>
                )}
              </>
            )}

            {step === 1 && (
              <section className="wr-section">
                <p className="wr-hint">
                  Lo que quedó sin terminar. Traelo a la próxima semana, mandalo al backlog o marcá
                  lo que en realidad ya está.
                  {resolvedCount > 0 && ` · ${resolvedCount} resuelta${resolvedCount === 1 ? '' : 's'}`}
                </p>
                {pending.length === 0 ? (
                  <p className="muted">
                    {data.unfinished.length === 0
                      ? 'No quedó nada pendiente esta semana. 🎉'
                      : 'Listo, no queda nada por resolver.'}
                  </p>
                ) : (
                  <ul className="wr-pending">
                    {pending.map((t) => (
                      <li key={t.id} className="wr-pending-item">
                        <div className="wr-pending-main">
                          <span className="wr-pending-name">{t.name || '(sin texto)'}</span>
                          <span className="wr-pending-meta">
                            {t.day}
                            {t.file && ` · ${t.file}`}
                            {t.hasSessions && ` · ${formatDurationLabel(t.loggedSeconds)}`}
                          </span>
                        </div>
                        <div className="wr-pending-actions">
                          <button
                            type="button"
                            className="btn btn-plain btn-small"
                            onClick={() => void act(t, 'done')}
                            disabled={busyId !== null}
                            title="Marcar como hecha"
                          >
                            ✓ Hecha
                          </button>
                          <button
                            type="button"
                            className="btn btn-tinted btn-small"
                            onClick={() => void act(t, 'bumped')}
                            disabled={busyId !== null}
                            title="Mover a la próxima semana (mismo día)"
                          >
                            → Próxima
                          </button>
                          {!t.hasSessions && (
                            <button
                              type="button"
                              className="btn btn-plain btn-small"
                              onClick={() => void act(t, 'backlog')}
                              disabled={busyId !== null}
                              title="Sacar de la agenda (al backlog)"
                            >
                              Backlog
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {step === 2 && (
              <section className="wr-section">
                {data.thisFocus && (
                  <p className="wr-prevfocus">
                    <span className="wr-prevfocus-label">Tu foco para esta semana:</span>{' '}
                    {data.thisFocus}
                  </p>
                )}
                <label className="wr-focus-label" htmlFor="wr-focus">
                  Foco de la semana siguiente ({data.nextWeekLabel})
                </label>
                <textarea
                  id="wr-focus"
                  className="task-notes-input wr-focus-input"
                  value={focusText}
                  onChange={(e) => setFocusText(e.target.value)}
                  placeholder="¿Qué querés que pase esta semana? Una o dos líneas."
                  rows={3}
                  maxLength={2000}
                />
              </section>
            )}
          </div>
        )}

        <div className="sheet-actions wr-actions">
          <button type="button" className="btn btn-plain" onClick={onClose}>
            Cerrar
          </button>
          {step > 0 && (
            <button
              type="button"
              className="btn btn-plain"
              onClick={() => setStep((s) => s - 1)}
              disabled={loading}
            >
              Atrás
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              className="btn btn-filled"
              onClick={() => setStep((s) => s + 1)}
              disabled={loading || !data}
            >
              Siguiente
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-filled"
              onClick={() => void finish()}
              disabled={loading || !data || savingFocus}
            >
              {savingFocus ? 'Guardando…' : 'Guardar y cerrar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
