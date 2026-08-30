import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createGoal, deleteGoal, getGoals, UnauthorizedError } from '../api';
import { formatDurationLabel } from '../duration';
import { goalLabel, goalStatus } from '../goals';
import type { GoalProgress, Tag } from '../types';
import ConfirmDialog from './ConfirmDialog';
import { useT, type TFn } from '../i18n';

const NO_TAG = '__all__';

function errText(err: unknown, t: TFn): string {
  if (err instanceof UnauthorizedError) return t('goals.sessionExpired');
  return err instanceof Error ? err.message : t('common.somethingWrong');
}

function paceText(g: GoalProgress, t: TFn): string {
  const s = goalStatus(g);
  if (s.state === 'done') return t('goals.paceDone');
  const delta = formatDurationLabel(Math.abs(s.paceDeltaSeconds));
  if (s.state === 'on-track') return t('goals.paceOnTrack');
  return s.state === 'ahead' ? t('goals.paceAhead', { delta }) : t('goals.paceBehind', { delta });
}

export default function GoalsDialog({
  tags,
  fileId,
  onClose,
}: {
  tags: Tag[];
  fileId: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const allTasks = t('goals.allTasks');
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hours, setHours] = useState('');
  const [tagId, setTagId] = useState<string>(NO_TAG);
  const [pendingDelete, setPendingDelete] = useState<GoalProgress | null>(null);

  const reload = useCallback(async () => {
    try {
      setGoals((await getGoals()).goals);
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

  function submitNew(e: FormEvent) {
    e.preventDefault();
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) return;
    void run(async () => {
      await createGoal(Math.round(h * 60), tagId === NO_TAG ? null : tagId, fileId ?? undefined);
      setHours('');
      setTagId(NO_TAG);
    });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const g = pendingDelete;
    setPendingDelete(null);
    await run(() => deleteGoal(g.id));
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--goals"
        role="dialog"
        aria-modal="true"
        aria-labelledby="goals-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="goals-title">{t('goals.title')}</h2>

        <form className="goal-new" onSubmit={submitNew}>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.5"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder={t('goals.hoursPlaceholder')}
            disabled={busy}
            className="goal-hours-input"
            aria-label={t('goals.hoursLabel')}
          />
          <span className="goal-new-in">{t('goals.hoursIn')}</span>
          <select
            value={tagId}
            onChange={(e) => setTagId(e.target.value)}
            disabled={busy}
            className="goal-tag-select"
            aria-label={t('goals.tagLabel')}
          >
            <option value={NO_TAG}>{allTasks}</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-tinted btn-small" disabled={busy || !hours}>
            {t('common.add')}
          </button>
        </form>

        {loading ? (
          <p className="muted">{t('common.loading')}</p>
        ) : goals.length === 0 ? (
          <p className="muted">{t('goals.none')}</p>
        ) : (
          <ul className="goal-list">
            {goals.map((g) => {
              const s = goalStatus(g);
              return (
                <li key={g.id} className="goal-item" data-state={s.state}>
                  <div className="goal-item-head">
                    <span className="goal-item-name">{goalLabel(g, allTasks)}</span>
                    <button
                      type="button"
                      className="goal-item-delete"
                      onClick={() => setPendingDelete(g)}
                      disabled={busy}
                      aria-label={t('goals.deleteAria', { name: goalLabel(g, allTasks) })}
                      title={t('goals.deleteTitle')}
                    >
                      ×
                    </button>
                  </div>
                  <div className="goal-bar" title={t('goals.expectedPace', { value: formatDurationLabel(s.expectedSeconds) })}>
                    <div className="goal-bar-fill" style={{ width: `${s.progressPct}%` }} />
                    <div
                      className="goal-bar-pace"
                      style={{ left: `${Math.min(100, Math.round((s.expectedSeconds / s.targetSeconds) * 100)) || 0}%` }}
                    />
                  </div>
                  <p className="goal-item-meta">
                    <strong>{formatDurationLabel(g.loggedSeconds)}</strong> / {formatDurationLabel(s.targetSeconds)}
                    {s.state !== 'done' && <>{t('goals.remaining', { value: formatDurationLabel(s.remainingSeconds) })}</>}
                    {' · '}
                    <span className="goal-item-pace">{paceText(g, t)}</span>
                  </p>
                </li>
              );
            })}
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
          title={`Eliminar la meta "${goalLabel(pendingDelete)}"`}
          message={t('goals.deleteBody')}
          confirmLabel={t('common.delete')}
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
