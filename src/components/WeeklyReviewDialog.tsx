import { useCallback, useEffect, useMemo, useState } from 'react';
import { localizeDay, plural, useLang, useT } from '../i18n';
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

const STEP_KEYS = ['review.stepSummary', 'review.stepPending', 'review.stepFocus'] as const;

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
  embedded = false,
}: {
  /** Semana a revisar al abrir (label "2026.08.24 - 2026.08.28"). */
  initialWeek: string;
  onClose: () => void;
  /** Se llama tras mover/completar una tarea pendiente (para refrescar la agenda). */
  onChanged: () => void;
  /** Se usa embebida dentro de la pestaña "Stats" (sin backdrop ni botón
   *  Cerrar) en vez de como diálogo flotante. */
  embedded?: boolean;
}) {
  const t = useT();
  const { lang } = useLang();
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
    if (embedded) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, embedded]);

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
          ? t('common.sessionExpired')
          : err instanceof Error
            ? err.message
            : t('review.loadError')
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
      setError(err instanceof Error ? err.message : t('review.taskError'));
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
      setSavingFocus(false);
      if (!embedded) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('review.focusError'));
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
    <div
      className={embedded ? 'wr-embedded' : 'sheet-backdrop'}
      onClick={embedded ? undefined : onClose}
      role={embedded ? undefined : 'presentation'}
    >
      <div
        className={embedded ? 'wr-inner' : 'sheet sheet--analytics'}
        role={embedded ? undefined : 'dialog'}
        aria-modal={embedded ? undefined : true}
        aria-labelledby={embedded ? undefined : 'wr-title'}
        onClick={embedded ? undefined : (e) => e.stopPropagation()}
      >
        {!embedded && <h2 id="wr-title">{t('review.title')}</h2>}

        <div className="wr-weeknav">
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => data && setWeek(data.previousWeekLabel)}
            disabled={loading || !data}
            aria-label={t('day.prevWeek')}
          >
            ‹
          </button>
          <span className="wr-weeknav-label">{data?.week ?? week}</span>
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => data && setWeek(data.nextWeekLabel)}
            disabled={loading || !data}
            aria-label={t('day.nextWeek')}
          >
            ›
          </button>
        </div>

        <div className="segmented wr-steps">
          {STEP_KEYS.map((key, i) => (
            <button
              key={key}
              type="button"
              className={i === step ? 'is-active' : undefined}
              onClick={() => setStep(i)}
              disabled={loading || !data}
            >
              {i + 1}. {t(key)}
            </button>
          ))}
        </div>

        <div className="an-scroll">
          {error && <p className="error">{error}</p>}
          {loading && <p className="muted">{t('common.loading')}</p>}

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
                      <span className="wr-stat-label">{t('review.tasksDone')}</span>
                    </div>
                    <div className="wr-stat">
                      <span className="wr-stat-value">{formatDurationLabel(data.loggedSeconds)}</span>
                      <span className="wr-stat-label">
                        {t('review.logged')}
                        {deltaPct !== null && deltaPct !== 0 && (
                          <span className={deltaPct > 0 ? 'wr-delta is-up' : 'wr-delta is-down'}>
                            {deltaPct > 0 ? '▲' : '▼'} {Math.abs(deltaPct)}%
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  {data.loggedSeconds === 0 ? (
                    <p className="muted">{t('review.noTime')}</p>
                  ) : (
                    <>
                      {data.byContext.length > 0 && (
                        <section className="wr-section">
                          <h3>{t('review.byContext')}</h3>
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
                          <h3>{t('review.byTag')}</h3>
                          <Bars
                            rows={data.byTag.map((tag) => ({
                              key: tag.tagId,
                              label: tag.name,
                              seconds: tag.seconds,
                              color: tag.color,
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
                    {t('review.pendingHint')}
                    {resolvedCount > 0 && t('review.resolvedCount', { count: resolvedCount, word: plural(resolvedCount, t('review.resolvedOne'), t('review.resolvedMany')) })}
                  </p>
                  {pending.length === 0 ? (
                    <p className="muted">
                      {data.unfinished.length === 0
                        ? t('review.nothingPendingEver')
                        : t('review.nothingLeft')}
                    </p>
                  ) : (
                    <ul className="wr-pending">
                      {pending.map((task) => (
                        <li key={task.id} className="wr-pending-item">
                          <div className="wr-pending-main">
                            <span className="wr-pending-name">{task.name || t('taskList.noText')}</span>
                            <span className="wr-pending-meta">
                              {localizeDay(task.day, lang)}
                              {task.file && ` · ${task.file}`}
                              {task.hasSessions && ` · ${formatDurationLabel(task.loggedSeconds)}`}
                            </span>
                          </div>
                          <div className="wr-pending-actions">
                            <button
                              type="button"
                              className="btn btn-plain btn-small"
                              onClick={() => void act(task, 'done')}
                              disabled={busyId !== null}
                              title={t('review.markDoneTitle')}
                            >
                              {t('review.rowDone')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-tinted btn-small"
                              onClick={() => void act(task, 'bumped')}
                              disabled={busyId !== null}
                              title={t('review.bumpTitle')}
                            >
                              {t('review.rowBump')}
                            </button>
                            {!task.hasSessions && (
                              <button
                                type="button"
                                className="btn btn-plain btn-small"
                                onClick={() => void act(task, 'backlog')}
                                disabled={busyId !== null}
                                title={t('review.backlogTitle')}
                              >
                                {t('review.rowBacklog')}
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
                      <span className="wr-prevfocus-label">{t('review.thisFocus')}</span>{' '}
                      {data.thisFocus}
                    </p>
                  )}
                  <label className="wr-focus-label" htmlFor="wr-focus">
                    {t('review.focusLabel', { week: data.nextWeekLabel })}
                  </label>
                  <textarea
                    id="wr-focus"
                    className="task-notes-input wr-focus-input"
                    value={focusText}
                    onChange={(e) => setFocusText(e.target.value)}
                    placeholder={t('review.focusPlaceholder')}
                    rows={3}
                    maxLength={2000}
                  />
                </section>
              )}
            </div>
          )}
        </div>

        <div className="sheet-actions wr-actions">
          {!embedded && (
            <button type="button" className="btn btn-plain" onClick={onClose}>
              {t('common.close')}
            </button>
          )}
          {step > 0 && (
            <button
              type="button"
              className="btn btn-plain"
              onClick={() => setStep((s) => s - 1)}
              disabled={loading}
            >
              {t('review.back')}
            </button>
          )}
          {step < STEP_KEYS.length - 1 ? (
            <button
              type="button"
              className="btn btn-filled"
              onClick={() => setStep((s) => s + 1)}
              disabled={loading || !data}
            >
              {t('review.next')}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-filled"
              onClick={() => void finish()}
              disabled={loading || !data || savingFocus}
            >
              {savingFocus ? t('common.saving') : t('review.saveClose')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
