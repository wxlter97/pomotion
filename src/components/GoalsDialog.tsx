import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createGoal, deleteGoal, getGoals, UnauthorizedError } from '../api';
import { formatDurationLabel } from '../duration';
import { goalLabel, goalStatus } from '../goals';
import type { GoalProgress, Tag } from '../types';
import ConfirmDialog from './ConfirmDialog';

const NO_TAG = '__all__';

function errText(err: unknown): string {
  if (err instanceof UnauthorizedError) return 'La sesión expiró. Recargá la página.';
  return err instanceof Error ? err.message : 'Algo salió mal';
}

function paceText(g: GoalProgress): string {
  const s = goalStatus(g);
  if (s.state === 'done') return '✓ cumplida';
  const delta = formatDurationLabel(Math.abs(s.paceDeltaSeconds));
  if (s.state === 'on-track') return 'en ritmo';
  return s.state === 'ahead' ? `${delta} adelantada` : `${delta} atrás del ritmo`;
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

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(errText(err));
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
        <h2 id="goals-title">Metas del mes</h2>

        <form className="goal-new" onSubmit={submitNew}>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.5"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="horas"
            disabled={busy}
            className="goal-hours-input"
            aria-label="Horas objetivo"
          />
          <span className="goal-new-in">h en</span>
          <select
            value={tagId}
            onChange={(e) => setTagId(e.target.value)}
            disabled={busy}
            className="goal-tag-select"
            aria-label="Etiqueta"
          >
            <option value={NO_TAG}>Todas las tareas</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-tinted btn-small" disabled={busy || !hours}>
            Agregar
          </button>
        </form>

        {loading ? (
          <p className="muted">Cargando…</p>
        ) : goals.length === 0 ? (
          <p className="muted">Todavía no pusiste metas para este mes.</p>
        ) : (
          <ul className="goal-list">
            {goals.map((g) => {
              const s = goalStatus(g);
              return (
                <li key={g.id} className="goal-item" data-state={s.state}>
                  <div className="goal-item-head">
                    <span className="goal-item-name">{goalLabel(g)}</span>
                    <button
                      type="button"
                      className="goal-item-delete"
                      onClick={() => setPendingDelete(g)}
                      disabled={busy}
                      aria-label={`Eliminar meta ${goalLabel(g)}`}
                      title="Eliminar meta"
                    >
                      ×
                    </button>
                  </div>
                  <div className="goal-bar" title={`Ritmo esperado: ${formatDurationLabel(s.expectedSeconds)}`}>
                    <div className="goal-bar-fill" style={{ width: `${s.progressPct}%` }} />
                    <div
                      className="goal-bar-pace"
                      style={{ left: `${Math.min(100, Math.round((s.expectedSeconds / s.targetSeconds) * 100)) || 0}%` }}
                    />
                  </div>
                  <p className="goal-item-meta">
                    <strong>{formatDurationLabel(g.loggedSeconds)}</strong> / {formatDurationLabel(s.targetSeconds)}
                    {s.state !== 'done' && <> · faltan {formatDurationLabel(s.remainingSeconds)}</>}
                    {' · '}
                    <span className="goal-item-pace">{paceText(g)}</span>
                  </p>
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
          title={`Eliminar la meta "${goalLabel(pendingDelete)}"`}
          message="Borra la meta. No toca tus tareas ni sesiones."
          confirmLabel="Eliminar"
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
