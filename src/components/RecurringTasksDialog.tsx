import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  applyRecurring,
  createRecurringRule,
  deleteRecurringRule,
  getRecurringRules,
  updateRecurringRule,
  UnauthorizedError,
} from '../api';
import type { RecurringRule } from '../types';
import ConfirmDialog from './ConfirmDialog';

const DAYS: { n: string; label: string }[] = [
  { n: '1', label: 'L' },
  { n: '2', label: 'M' },
  { n: '3', label: 'X' },
  { n: '4', label: 'J' },
  { n: '5', label: 'V' },
  { n: '6', label: 'S' },
  { n: '7', label: 'D' },
];

function weekdaysSummary(csv: string): string {
  const set = new Set(csv.split(','));
  if (['1', '2', '3', '4', '5'].every((d) => set.has(d)) && set.size === 5) return 'Lun–Vie';
  return DAYS.filter((d) => set.has(d.n))
    .map((d) => d.label)
    .join(' ');
}

export default function RecurringTasksDialog({
  fileId,
  currentWeek,
  onClose,
  onApplied,
}: {
  fileId: string | null;
  /** Semana visible ahora — a la que apunta "Aplicar a esta semana". */
  currentWeek: string;
  onClose: () => void;
  onApplied: (added: number) => void;
}) {
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newText, setNewText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [pendingDelete, setPendingDelete] = useState<RecurringRule | null>(null);

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape' && !editingId && !pendingDelete) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, editingId, pendingDelete]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await getRecurringRules();
        if (!cancelled) setRules(res.rules);
      } catch (err) {
        if (!cancelled) setError(errMessage(err, 'No se pudieron cargar las recurrentes'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitNew(e: FormEvent) {
    e.preventDefault();
    const name = newText.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createRecurringRule(name);
      setRules((prev) => [...prev, res.rule]);
      setNewText('');
    } catch (err) {
      setError(errMessage(err, 'No se pudo agregar la regla'));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(rule: RecurringRule) {
    setEditingId(rule.id);
    setEditingText(rule.name);
  }

  async function submitEdit(rule: RecurringRule) {
    const name = editingText.trim();
    if (!name || name === rule.name) {
      setEditingId(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await updateRecurringRule(rule.id, { name });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? res.rule : r)));
      setEditingId(null);
    } catch (err) {
      setError(errMessage(err, 'No se pudo actualizar la regla'));
    } finally {
      setBusy(false);
    }
  }

  function onEditKeyDown(e: KeyboardEvent<HTMLInputElement>, rule: RecurringRule) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitEdit(rule);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditingId(null);
    }
  }

  async function toggleDay(rule: RecurringRule, day: string) {
    const set = new Set(rule.weekdays.split(','));
    if (set.has(day)) set.delete(day);
    else set.add(day);
    if (set.size === 0) return; // al menos un día
    const weekdays = DAYS.filter((d) => set.has(d.n))
      .map((d) => d.n)
      .join(',');
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, weekdays } : r)));
    try {
      await updateRecurringRule(rule.id, { weekdays });
    } catch (err) {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? rule : r))); // revertir
      setError(errMessage(err, 'No se pudo actualizar los días'));
    }
  }

  async function confirmDelete() {
    const rule = pendingDelete;
    if (!rule) return;
    setBusy(true);
    setError(null);
    try {
      await deleteRecurringRule(rule.id);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
      setPendingDelete(null);
    } catch (err) {
      setError(errMessage(err, 'No se pudo eliminar la regla'));
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    setBusy(true);
    setError(null);
    try {
      const res = await applyRecurring(currentWeek, fileId ?? undefined);
      onApplied(res.added);
      onClose();
    } catch (err) {
      setError(errMessage(err, 'No se pudieron aplicar las recurrentes'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recurring-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="recurring-title">Tareas recurrentes</h2>
        <p className="muted">
          Se agregan solas a cada semana nueva, en los días marcados. Si creás una regla a mitad de
          semana, usá «Aplicar» para traerla a la semana visible.
        </p>

        {loading ? (
          <p className="muted">Cargando…</p>
        ) : (
          <>
            {rules.length === 0 ? (
              <p className="muted">No hay reglas todavía.</p>
            ) : (
              <ul className="recurring-list">
                {rules.map((rule) => (
                  <li key={rule.id}>
                    {editingId === rule.id ? (
                      <div className="recurring-edit">
                        <input
                          type="text"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onKeyDown={(e) => onEditKeyDown(e, rule)}
                          disabled={busy}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="btn btn-icon"
                          onClick={() => void submitEdit(rule)}
                          disabled={busy}
                          aria-label="Guardar"
                          title="Guardar"
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          className="btn btn-icon"
                          onClick={() => setEditingId(null)}
                          disabled={busy}
                          aria-label="Cancelar"
                          title="Cancelar"
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="recurring-text">{rule.name}</span>
                        <div className="recurring-days" title={weekdaysSummary(rule.weekdays)}>
                          {DAYS.map((d) => (
                            <button
                              key={d.n}
                              type="button"
                              className={
                                rule.weekdays.split(',').includes(d.n)
                                  ? 'recurring-day on'
                                  : 'recurring-day'
                              }
                              onClick={() => void toggleDay(rule, d.n)}
                              aria-label={`Día ${d.label}`}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>
                        <div className="recurring-actions">
                          <button
                            type="button"
                            className="task-move"
                            onClick={() => startEdit(rule)}
                            disabled={busy}
                            aria-label="Editar"
                            title="Editar"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="task-delete"
                            onClick={() => setPendingDelete(rule)}
                            disabled={busy}
                            aria-label="Eliminar"
                            title="Eliminar"
                          >
                            ×
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <form className="task-add-form" onSubmit={submitNew}>
              <input
                type="text"
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                placeholder="Agregar regla recurrente…"
                disabled={busy}
              />
              <button type="submit" className="btn btn-tinted" disabled={busy || !newText.trim()}>
                Agregar
              </button>
            </form>
          </>
        )}

        {error && <p className="error">{error}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn btn-plain" onClick={onClose}>
            Cerrar
          </button>
          <button
            type="button"
            className="btn btn-filled"
            onClick={() => void handleApply()}
            disabled={busy || rules.length === 0}
            title={`Aplicar a ${currentWeek}`}
          >
            {busy ? 'Aplicando…' : 'Aplicar a esta semana'}
          </button>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar regla recurrente"
          message={`Se quita "${pendingDelete.name}". Las tareas ya creadas en algún día no se tocan.`}
          confirmLabel={busy ? 'Eliminando…' : 'Eliminar'}
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof UnauthorizedError)
    return 'La sesión expiró. Recargá la página para volver a entrar.';
  return err instanceof Error ? err.message : fallback;
}
