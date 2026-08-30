import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  applyRecurring,
  createRecurringRule,
  deleteRecurringRule,
  getRecurringRules,
  updateRecurringRule,
  UnauthorizedError,
} from '../api';
import type { RecurringFreq, RecurringRule } from '../types';
import ConfirmDialog from './ConfirmDialog';
import { useT, type TFn } from '../i18n';

const DAY_NUMS = ['1', '2', '3', '4', '5', '6', '7'];

const MONTHDAYS = Array.from({ length: 31 }, (_, i) => i + 1);

function ruleSummary(rule: RecurringRule, t: TFn): string {
  const letters = t('recurring.weekdayLetters').split(',');
  if (rule.freq === 'monthly') {
    const days = rule.monthdays.split(',').filter(Boolean);
    if (days.length === 0) return t('recurring.summaryNoDays');
    return days
      .map((d) => (d === '-1' ? t('recurring.summaryLastDay') : t('recurring.summaryMonthDay', { d })))
      .join(', ');
  }
  const set = new Set(rule.weekdays.split(','));
  if (['1', '2', '3', '4', '5'].every((d) => set.has(d)) && set.size === 5) return t('recurring.summaryMonFri');
  return DAY_NUMS.filter((n) => set.has(n)).map((n) => letters[Number(n) - 1]).join(' ');
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
  const t = useT();
  const dayLetters = t('recurring.weekdayLetters').split(',');
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
        if (!cancelled) setError(errMessage(err, t, 'recurring.loadError'));
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
      setError(errMessage(err, t, 'recurring.addError'));
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
      setError(errMessage(err, t, 'recurring.updateError'));
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

  /** Guarda un cambio de recurrencia con optimismo + revertir si falla. */
  async function patchRule(rule: RecurringRule, patch: Partial<RecurringRule>) {
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, ...patch } : r)));
    setError(null);
    try {
      await updateRecurringRule(rule.id, patch);
    } catch (err) {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? rule : r))); // revertir
      setError(errMessage(err, t, 'recurring.updateError'));
    }
  }

  function setFreq(rule: RecurringRule, freq: RecurringFreq) {
    if (rule.freq === freq) return;
    // Al pasar a mensual sin días elegidos, arrancar en "día 1".
    const monthdays = freq === 'monthly' && !rule.monthdays ? '1' : rule.monthdays;
    void patchRule(rule, { freq, monthdays });
  }

  function toggleDay(rule: RecurringRule, day: string) {
    const set = new Set(rule.weekdays.split(','));
    if (set.has(day)) set.delete(day);
    else set.add(day);
    if (set.size === 0) return; // al menos un día
    const weekdays = DAY_NUMS.filter((n) => set.has(n)).join(',');
    void patchRule(rule, { weekdays });
  }

  function toggleMonthday(rule: RecurringRule, token: string) {
    const set = new Set(rule.monthdays.split(',').filter(Boolean));
    if (set.has(token)) set.delete(token);
    else set.add(token);
    if (set.size === 0) return; // al menos un día
    const monthdays = [...set]
      .map(Number)
      .sort((a, b) => a - b)
      .join(',');
    void patchRule(rule, { monthdays });
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
      setError(errMessage(err, t, 'recurring.deleteError'));
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
      setError(errMessage(err, t, 'recurring.applyError'));
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
        <h2 id="recurring-title">{t('recurring.title')}</h2>
        <p className="muted">{t('recurring.intro')}</p>

        {loading ? (
          <p className="muted">{t('common.loading')}</p>
        ) : (
          <>
            {rules.length === 0 ? (
              <p className="muted">{t('recurring.none')}</p>
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
                          aria-label={t('common.save')}
                          title={t('common.save')}
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          className="btn btn-icon"
                          onClick={() => setEditingId(null)}
                          disabled={busy}
                          aria-label={t('common.cancel')}
                          title={t('common.cancel')}
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="recurring-row-top">
                          <span className="recurring-text">{rule.name}</span>

                          <div className="segmented recurring-freq">
                            <button
                              type="button"
                              className={rule.freq === 'weekly' ? 'is-active' : undefined}
                              onClick={() => setFreq(rule, 'weekly')}
                            >
                              {t('recurring.weekly')}
                            </button>
                            <button
                              type="button"
                              className={rule.freq === 'monthly' ? 'is-active' : undefined}
                              onClick={() => setFreq(rule, 'monthly')}
                            >
                              {t('recurring.monthly')}
                            </button>
                          </div>

                          <div className="recurring-actions">
                            <button
                              type="button"
                              className="task-move"
                              onClick={() => startEdit(rule)}
                              disabled={busy}
                              aria-label={t('common.edit')}
                              title={t('common.edit')}
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              className="task-delete"
                              onClick={() => setPendingDelete(rule)}
                              disabled={busy}
                              aria-label={t('common.delete')}
                              title={t('common.delete')}
                            >
                              ×
                            </button>
                          </div>
                        </div>

                        {rule.freq === 'weekly' ? (
                          <div className="recurring-days" title={ruleSummary(rule, t)}>
                            {DAY_NUMS.map((n, i) => (
                              <button
                                key={n}
                                type="button"
                                className={
                                  rule.weekdays.split(',').includes(n)
                                    ? 'recurring-day on'
                                    : 'recurring-day'
                                }
                                onClick={() => toggleDay(rule, n)}
                                aria-label={t('recurring.weekdayLabel', { label: dayLetters[i] })}
                              >
                                {dayLetters[i]}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="recurring-monthdays" title={ruleSummary(rule, t)}>
                            {MONTHDAYS.map((n) => (
                              <button
                                key={n}
                                type="button"
                                className={
                                  rule.monthdays.split(',').includes(String(n))
                                    ? 'recurring-monthday on'
                                    : 'recurring-monthday'
                                }
                                onClick={() => toggleMonthday(rule, String(n))}
                                aria-label={t('recurring.everyMonthDay', { n })}
                              >
                                {n}
                              </button>
                            ))}
                            <button
                              type="button"
                              className={
                                rule.monthdays.split(',').includes('-1')
                                  ? 'recurring-monthday is-last on'
                                  : 'recurring-monthday is-last'
                              }
                              onClick={() => toggleMonthday(rule, '-1')}
                              title={t('recurring.lastDayTitle')}
                            >
                              {t('recurring.lastDay')}
                            </button>
                          </div>
                        )}

                        <div className="recurring-time-row">
                          <span className="recurring-time-label">{t('recurring.defaultTime')}</span>
                          <input
                            type="time"
                            className="task-planned-start-input"
                            value={rule.defaultPlannedStart ?? ''}
                            onChange={(e) =>
                              void patchRule(rule, { defaultPlannedStart: e.target.value || null })
                            }
                            disabled={busy}
                          />
                          {rule.defaultPlannedStart && (
                            <button
                              type="button"
                              className="btn btn-plain btn-small"
                              onClick={() => void patchRule(rule, { defaultPlannedStart: null })}
                              disabled={busy}
                            >
                              {t('details.remove')}
                            </button>
                          )}
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
                placeholder={t('recurring.addPlaceholder')}
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
            {busy ? t('recurring.applying') : t('recurring.apply')}
          </button>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={t('recurring.deleteTitle')}
          message={t('recurring.deleteConfirmBody', { name: pendingDelete.name })}
          confirmLabel={busy ? t('common.deleting') : t('common.delete')}
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function errMessage(err: unknown, t: TFn, fallbackKey: Parameters<TFn>[0]): string {
  if (err instanceof UnauthorizedError) return t('common.sessionExpired');
  return err instanceof Error ? err.message : t(fallbackKey);
}
