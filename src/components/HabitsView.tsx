import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  createHabit,
  deleteHabit,
  getHabits,
  toggleHabitLog,
  UnauthorizedError,
  updateHabit,
} from '../api';
import { DEFAULT_TAG_COLOR, TAG_COLORS, tagColorOf, type TagColor } from '../tags';
import type { Habit } from '../types';
import ConfirmDialog from './ConfirmDialog';
import { useT, type MsgKey, type TFn } from '../i18n';

function errText(err: unknown, t: TFn): string {
  if (err instanceof UnauthorizedError) return t('habits.sessionExpired');
  return err instanceof Error ? err.message : t('common.somethingWrong');
}

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysLocal(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return ymdLocal(new Date(y, (m ?? 1) - 1, (d ?? 1) + days));
}

/** Últimos 7 días (más viejo primero, hoy al final). */
function lastSevenDays(today: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysLocal(today, -(6 - i)));
}

function Swatches({
  value,
  onPick,
  disabled,
}: {
  value: TagColor;
  onPick: (c: TagColor) => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <div className="tag-swatches">
      {TAG_COLORS.map((c) => (
        <button
          key={c.key}
          type="button"
          className={c.key === value ? 'tag-swatch is-active' : 'tag-swatch'}
          data-tag-color={c.key}
          onClick={() => onPick(c.key)}
          disabled={disabled}
          aria-label={t(`tags.color.${c.key}` as MsgKey)}
          title={t(`tags.color.${c.key}` as MsgKey)}
        />
      ))}
    </div>
  );
}

/** Vista de un contexto de tipo 'hábito': lista de hábitos con un check por
 *  día (última semana) y racha actual / mejor racha. Reemplaza al tablero de
 *  tareas para ese contexto — sin horario ni timer, solo hecho/no hecho. */
export default function HabitsView({ contextId }: { contextId: string }) {
  const t = useT();
  const today = ymdLocal(new Date());
  const days = lastSevenDays(today);

  const [habits, setHabits] = useState<Habit[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<TagColor>(DEFAULT_TAG_COLOR);
  const [creating, setCreating] = useState(false);

  const [showArchived, setShowArchived] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Habit | null>(null);

  const reload = useCallback(async () => {
    try {
      setHabits((await getHabits(contextId)).habits);
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  async function submitNew(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      await createHabit(contextId, name, newColor);
      setNewName('');
      setNewColor(DEFAULT_TAG_COLOR);
      await reload();
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setCreating(false);
    }
  }

  async function toggle(habit: Habit, date: string) {
    setBusyId(habit.id);
    setError(null);
    try {
      await toggleHabitLog(habit.id, date, !habit.doneDates.includes(date));
      await reload();
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleArchived(habit: Habit) {
    setBusyId(habit.id);
    setError(null);
    try {
      await updateHabit(habit.id, { archived: !habit.archived });
      await reload();
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const habit = pendingDelete;
    setPendingDelete(null);
    setBusyId(habit.id);
    setError(null);
    try {
      await deleteHabit(habit.id);
      await reload();
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setBusyId(null);
    }
  }

  const active = habits.filter((h) => !h.archived);
  const archived = habits.filter((h) => h.archived);

  return (
    <div className="habits-view card">
      <form className="habit-new-form" onSubmit={submitNew}>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('habits.newPlaceholder')}
          disabled={creating}
          maxLength={60}
        />
        <Swatches value={newColor} onPick={setNewColor} disabled={creating} />
        <button type="submit" className="btn btn-tinted btn-small" disabled={creating || !newName.trim()}>
          {t('common.add')}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : active.length === 0 ? (
        <p className="muted">{t('habits.none')}</p>
      ) : (
        <ul className="habit-list">
          {active.map((habit) => (
            <li key={habit.id} className="habit-row" data-tag-color={tagColorOf(habit.color)}>
              <div className="habit-row-head">
                <span className="habit-dot" aria-hidden="true" />
                <span className="habit-name">{habit.name}</span>
                <span className="habit-streaks">
                  {habit.currentStreak > 0 && (
                    <span className="habit-streak habit-streak-current" title={t('habits.streakCurrent')}>
                      🔥 {habit.currentStreak}
                    </span>
                  )}
                  {habit.bestStreak > 0 && (
                    <span className="habit-streak habit-streak-best" title={t('habits.streakBest')}>
                      🏆 {habit.bestStreak}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="habit-archive"
                  onClick={() => void toggleArchived(habit)}
                  disabled={busyId === habit.id}
                  title={t('habits.archiveTitle')}
                >
                  {t('habits.archive')}
                </button>
                <button
                  type="button"
                  className="habit-delete"
                  onClick={() => setPendingDelete(habit)}
                  disabled={busyId === habit.id}
                  aria-label={t('habits.deleteAria', { name: habit.name })}
                  title={t('habits.deleteTitle')}
                >
                  ×
                </button>
              </div>
              <div className="habit-week">
                {days.map((day) => {
                  const done = habit.doneDates.includes(day);
                  const isToday = day === today;
                  return (
                    <button
                      key={day}
                      type="button"
                      className={done ? 'habit-day is-done' : 'habit-day'}
                      data-today={isToday || undefined}
                      onClick={() => void toggle(habit, day)}
                      disabled={busyId === habit.id}
                      aria-pressed={done}
                      aria-label={t('habits.checkAria', { name: habit.name, date: day })}
                      title={day}
                    >
                      {Number(day.slice(8, 10))}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <div className="habit-archived">
          <button type="button" className="btn btn-plain btn-small" onClick={() => setShowArchived((v) => !v)}>
            {t(showArchived ? 'habits.hideArchived' : 'habits.showArchived', { n: archived.length })}
          </button>
          {showArchived && (
            <ul className="habit-list habit-list--archived">
              {archived.map((habit) => (
                <li key={habit.id} className="habit-row habit-row--archived" data-tag-color={tagColorOf(habit.color)}>
                  <div className="habit-row-head">
                    <span className="habit-dot" aria-hidden="true" />
                    <span className="habit-name">{habit.name}</span>
                    <button
                      type="button"
                      className="habit-archive"
                      onClick={() => void toggleArchived(habit)}
                      disabled={busyId === habit.id}
                    >
                      {t('habits.unarchive')}
                    </button>
                    <button
                      type="button"
                      className="habit-delete"
                      onClick={() => setPendingDelete(habit)}
                      disabled={busyId === habit.id}
                      aria-label={t('habits.deleteAria', { name: habit.name })}
                      title={t('habits.deleteTitle')}
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={t('habits.deleteTitle')}
          message={t('habits.deleteBody', { name: pendingDelete.name })}
          confirmLabel={t('common.delete')}
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
