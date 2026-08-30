import { useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  createTask,
  deleteSession,
  deleteTask,
  postManualSession,
  updateSession,
  updateTaskText,
} from '../api';
import {
  TIME_RE,
  addMinutesToTime,
  formatDurationLabel,
  isValidTimeLabel,
  nowAsHHMM,
  parseDurationToSeconds,
} from '../duration';
import type { Session, Tag, Task } from '../types';
import {
  daysBetween,
  dueChipLabel,
  dueLabel,
  isOverdue,
  taskAgeLabel,
  taskAgeTitle,
  taskTimeSummary,
} from '../taskMeta';
import { checklistLabel } from '../checklist';
import { resolveTags, tagColorOf } from '../tags';
import { useDrag } from '../drag/DragProvider';
import { useLang, useT } from '../i18n';

/** El chip de vencimiento en la fila solo aparece si está cerca o vencido;
 *  fechas más lejanas se ven al editar (el botón ✎ queda marcado). */
const DUE_CHIP_WINDOW_DAYS = 3;
import ConfirmDialog from './ConfirmDialog';
import TaskRowMenu, { type MoveTarget } from './TaskRowMenu';
import TaskDetails from './TaskDetails';

function sumSeconds(task: Task): number {
  return task.sessions.reduce((total, s) => total + s.durationSeconds, 0);
}

type SessionDraft = { duration: string; start: string; end: string };

function timeLabelToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Rango en minutos-del-día como [inicio, fin); si fin <= inicio se asume
// que la sesión cruza la medianoche (termina al día siguiente).
function timeRangeMinutes(start: string, end: string): [number, number] {
  const s = timeLabelToMinutes(start);
  let e = timeLabelToMinutes(end);
  if (e <= s) e += 1440;
  return [s, e];
}

function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

// Aviso (no bloqueante) de solapamiento: compara contra cualquier otra
// sesión ya registrada ese día, en cualquier tarea. `excludeSessionId` deja
// afuera la sesión que se está editando.
function findOverlap(
  allTasks: Task[],
  excludeSessionId: string | null,
  start: string,
  end: string
): { task: Task; session: Session } | null {
  if (!isValidTimeLabel(start) || !isValidTimeLabel(end)) return null;
  const candidate = timeRangeMinutes(start, end);
  for (const t of allTasks) {
    for (const s of t.sessions) {
      if (s.id === excludeSessionId) continue;
      if (!isValidTimeLabel(s.start) || !isValidTimeLabel(s.end)) continue;
      if (rangesOverlap(candidate, timeRangeMinutes(s.start, s.end))) {
        return { task: t, session: s };
      }
    }
  }
  return null;
}

export default function TaskList({
  tasks,
  selectedTaskId,
  onSelect,
  onToggleDone,
  togglingIds,
  onSessionDeleted,
  selectedDate,
  today,
  previousWeekLabel,
  nextWeekLabel,
  fileId,
  allTags,
  onManageTags,
  canReorder = true,
  lockedTaskId,
  busyTaskIds,
  selectedIds,
  onToggleSelect,
  onStartSelect,
  onTaskCreated,
  onTaskDeleted,
  onTaskTextUpdated,
  onTaskUpdated,
  onMoveTask,
  onSendToInbox,
  onSessionUpdated,
  onManualSessionAdded,
}: {
  tasks: Task[];
  selectedTaskId: string | null;
  onSelect: (task: Task) => void;
  onToggleDone: (task: Task) => void;
  togglingIds: Set<string>;
  onSessionDeleted: (taskId: string, sessionId: string) => void;
  selectedDate: string;
  today: string;
  previousWeekLabel: string;
  nextWeekLabel: string;
  fileId: string | null;
  allTags: Tag[];
  onManageTags: () => void;
  /** Con un filtro por etiqueta activo se desactiva reordenar (los índices
   *  no corresponden al orden real). Default true. */
  canReorder?: boolean;
  lockedTaskId: string | null;
  busyTaskIds: Set<string>;
  /** ids marcados para acciones en lote; `size > 0` = modo selección. */
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  /** Entrar en modo selección con esta tarea marcada (desde el menú ⋮). */
  onStartSelect: (id: string) => void;
  onTaskCreated: (task: Task) => void;
  onTaskDeleted: (task: Task) => void;
  onTaskTextUpdated: (id: string, name: string) => void;
  onTaskUpdated: (id: string, patch: Partial<Task>) => void;
  /** Mover a un día de otra semana (el menú ⋮); dentro de la semana visible
   *  se hace arrastrando a la pestaña del día. */
  onMoveTask: (task: Task, target: MoveTarget) => void;
  onSendToInbox: (task: Task) => void;
  onSessionUpdated: (taskId: string, session: Session) => void;
  onManualSessionAdded: (taskId: string, session: Session) => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<{ taskId: string; sessionId: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pendingTaskDelete, setPendingTaskDelete] = useState<Task | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);

  const [newTaskText, setNewTaskText] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const { beginDrag, draggingId } = useDrag();
  const t = useT();
  const { lang } = useLang();

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskText, setEditingTaskText] = useState('');
  const [savingTaskText, setSavingTaskText] = useState(false);

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionDraft, setSessionDraft] = useState<SessionDraft>({ duration: '', start: '', end: '' });
  const [savingSession, setSavingSession] = useState(false);

  const [manualEntryTaskId, setManualEntryTaskId] = useState<string | null>(null);
  const [manualDraft, setManualDraft] = useState<SessionDraft>({ duration: '', start: '', end: '' });
  const [addingManualSession, setAddingManualSession] = useState(false);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteSession(pendingDelete.sessionId);
      onSessionDeleted(pendingDelete.taskId, pendingDelete.sessionId);
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('session.deleteError'));
    } finally {
      setDeleting(false);
    }
  }

  async function confirmDeleteTask() {
    if (!pendingTaskDelete) return;
    setDeletingTask(true);
    setError(null);
    try {
      await deleteTask(pendingTaskDelete.id);
      onTaskDeleted(pendingTaskDelete);
      setPendingTaskDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('taskList.deleteError'));
    } finally {
      setDeletingTask(false);
    }
  }

  async function submitAdd() {
    const trimmed = newTaskText.trim();
    if (!trimmed) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await createTask(selectedDate, trimmed, fileId ?? undefined);
      onTaskCreated(res.task);
      setNewTaskText('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : t('taskList.createError'));
    } finally {
      setAdding(false);
    }
  }

  function handleAddSubmit(e: FormEvent) {
    e.preventDefault();
    void submitAdd();
  }

  function handleAddKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitAdd();
    }
  }

  // Arrastre a mano (pointer events): reordenar dentro del día, mover a la
  // pestaña de otro día o al inbox. El drag real lo arranca el DragProvider
  // al superar el umbral / mantener presionado, así el tap para seleccionar
  // la tarea sigue andando.
  function handleRowPointerDown(e: ReactPointerEvent, task: Task, index: number) {
    if (!canReorder || selectMode) return;
    if (busyTaskIds.has(task.id) || lockedTaskId === task.id) return;
    if (editingTaskId === task.id) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, .task-check, .move-menu-wrap, .task-edit-form')) return;
    beginDrag({ kind: 'task', task, index }, e, task.name);
  }

  function startEditTask(task: Task) {
    setEditingTaskId(task.id);
    setEditingTaskText(task.name);
  }

  async function submitTaskTextEdit(task: Task) {
    const trimmed = editingTaskText.trim();
    if (!trimmed) return;
    if (trimmed === task.name) {
      setEditingTaskId(null);
      return;
    }
    setSavingTaskText(true);
    setError(null);
    try {
      await updateTaskText(task.id, trimmed);
      onTaskTextUpdated(task.id, trimmed);
      setEditingTaskId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('taskList.updateError'));
    } finally {
      setSavingTaskText(false);
    }
  }

  function handleTaskEditKeyDown(e: KeyboardEvent<HTMLInputElement>, task: Task) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitTaskTextEdit(task);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditingTaskId(null);
    }
  }

  function startEditSession(s: Session) {
    setEditingSessionId(s.id);
    setSessionDraft({ duration: formatDurationLabel(s.durationSeconds), start: s.start, end: s.end });
  }

  function validateDraft(draft: SessionDraft): { duration: number; start: string; end: string } | null {
    const duration = parseDurationToSeconds(draft.duration);
    const start = draft.start.trim();
    const end = draft.end.trim();
    if (duration === null || duration <= 0) {
      setError(t('session.badDuration'));
      return null;
    }
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
      setError(t('session.badTime'));
      return null;
    }
    return { duration, start, end };
  }

  function deriveEnd(start: string, durationInput: string): string | null {
    const seconds = parseDurationToSeconds(durationInput);
    if (seconds === null || seconds <= 0) return null;
    const trimmedStart = start.trim();
    if (!TIME_RE.test(trimmedStart)) return null;
    return addMinutesToTime(trimmedStart, Math.round(seconds / 60));
  }

  function handleSessionDurationChange(value: string) {
    setSessionDraft((d) => ({ ...d, duration: value, end: deriveEnd(d.start, value) ?? d.end }));
  }
  function handleSessionStartChange(value: string) {
    setSessionDraft((d) => ({ ...d, start: value, end: deriveEnd(value, d.duration) ?? d.end }));
  }
  function handleManualDurationChange(value: string) {
    setManualDraft((d) => ({ ...d, duration: value, end: deriveEnd(d.start, value) ?? d.end }));
  }
  function handleManualStartChange(value: string) {
    setManualDraft((d) => ({ ...d, start: value, end: deriveEnd(value, d.duration) ?? d.end }));
  }

  async function submitSessionEdit(taskId: string, sessionId: string) {
    setError(null);
    const parsed = validateDraft(sessionDraft);
    if (!parsed) return;
    setSavingSession(true);
    try {
      const res = await updateSession(sessionId, parsed.duration, parsed.start, parsed.end);
      onSessionUpdated(taskId, res.session);
      setEditingSessionId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('session.updateError'));
    } finally {
      setSavingSession(false);
    }
  }

  // Encadena con la sesión más reciente de la tarea (mayor hora de fin) si
  // hay alguna válida; si no, usa la hora actual.
  function defaultManualStart(task: Task): string {
    let latestEnd: string | null = null;
    for (const s of task.sessions) {
      if (!isValidTimeLabel(s.end)) continue;
      if (latestEnd === null || timeLabelToMinutes(s.end) > timeLabelToMinutes(latestEnd)) {
        latestEnd = s.end;
      }
    }
    return latestEnd ?? nowAsHHMM();
  }

  function openManualEntry(task: Task) {
    setManualEntryTaskId(task.id);
    setManualDraft({ duration: '', start: defaultManualStart(task), end: '' });
  }

  async function submitManualEntry(task: Task) {
    setError(null);
    const parsed = validateDraft(manualDraft);
    if (!parsed) return;
    setAddingManualSession(true);
    try {
      const res = await postManualSession(task.id, parsed.duration, parsed.start, parsed.end);
      onManualSessionAdded(task.id, res.session);
      setManualEntryTaskId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('session.addError'));
    } finally {
      setAddingManualSession(false);
    }
  }

  const selectMode = selectedIds.size > 0;

  return (
    <>
      {/* El <ul> entero es zona de drop "al final del día": soltar en el
          margen (o en un día vacío) manda la tarea al final de la lista. */}
      <ul className="task-list" data-drag-zone="list-end">
        {tasks.length === 0 ? (
          <li className="muted task-list-empty">No hay tareas para este día.</li>
        ) : (
          tasks.map((task, i) => {
            const total = sumSeconds(task);
            const timeSummary = taskTimeSummary(total, task.estimateMinutes, t);
            const taskTags = resolveTags(task.tagIds, allTags);
            const checklistText = checklistLabel(task.checklist);
            const checklistDone = task.checklist.length > 0 && task.checklist.every((c) => c.done);
            // Chip de "lleva mucho abierta": solo en tareas sin hacer y que no
            // sean de un día futuro (planificar a futuro no es estar estancado).
            const ageLabel =
              !task.done && selectedDate <= today
                ? taskAgeLabel(task.createdAt, today, t)
                : null;
            const manualOverlap =
              manualEntryTaskId === task.id
                ? findOverlap(tasks, null, manualDraft.start, manualDraft.end)
                : null;
            const isToggling = togglingIds.has(task.id);
            const isLocked = lockedTaskId === task.id;
            const isBusy = busyTaskIds.has(task.id);
            const disableEdit = isLocked || isBusy;
            const isEditingText = editingTaskId === task.id;
            const isSelected = selectedIds.has(task.id);
            const selectDisabled = selectMode && isLocked;

            return (
              <li
                key={task.id}
                data-drag-zone={`row:${i}`}
                className={draggingId === task.id ? 'is-drag-src' : undefined}
              >
                <div
                  onPointerDown={(e) => handleRowPointerDown(e, task, i)}
                  className={[
                    'task-item',
                    task.id === selectedTaskId && !selectMode ? 'active' : '',
                    isLocked ? 'locked' : '',
                    selectMode ? 'is-selecting' : '',
                    isSelected ? 'is-selected' : '',
                    canReorder && !disableEdit && !isEditingText && !selectMode ? 'is-draggable' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-priority={task.priority ?? undefined}
                  title={isLocked ? t('taskList.lockedTitle') : undefined}
                >
                  <button
                    type="button"
                    className={
                      (selectMode ? isSelected : task.done) ? 'task-check checked' : 'task-check'
                    }
                    onClick={() =>
                      selectMode ? onToggleSelect(task.id) : onToggleDone(task)
                    }
                    disabled={selectMode ? selectDisabled : isToggling}
                    aria-label={
                      selectMode
                        ? isSelected
                          ? t('taskList.removeFromSelection')
                          : t('taskList.addToSelection')
                        : task.done
                          ? t('taskList.markPending')
                          : t('taskList.markDone')
                    }
                    title={
                      selectMode
                        ? t('taskList.select')
                        : task.done
                          ? t('taskList.markPending')
                          : t('taskList.markDone')
                    }
                  >
                    {(selectMode ? isSelected : !isToggling && task.done) ? '✓' : ''}
                  </button>

                  {isEditingText ? (
                    <div className="task-edit-form">
                      <input
                        type="text"
                        value={editingTaskText}
                        onChange={(e) => setEditingTaskText(e.target.value)}
                        onKeyDown={(e) => handleTaskEditKeyDown(e, task)}
                        disabled={savingTaskText}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="btn btn-icon"
                        onClick={() => void submitTaskTextEdit(task)}
                        disabled={savingTaskText}
                        aria-label={t('common.save')}
                        title={t('common.save')}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className="btn btn-icon"
                        onClick={() => setEditingTaskId(null)}
                        disabled={savingTaskText}
                        aria-label={t('common.cancel')}
                        title={t('common.cancel')}
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="task-select"
                      onClick={() => (selectMode ? onToggleSelect(task.id) : onSelect(task))}
                      disabled={selectDisabled}
                    >
                      {task.source === 'calendar' && (
                        <span className="task-src" title={t('taskList.fromCalendar')} aria-label={t('taskList.fromCalendar')}>
                          📅
                        </span>
                      )}
                      <span className="task-text">{task.name || t('taskList.noText')}</span>
                    </button>
                  )}

                  {!isEditingText && taskTags.length > 0 && (
                    <span className="task-tags">
                      {taskTags.map((t) => (
                        <span
                          key={t.id}
                          className="task-tag"
                          data-tag-color={tagColorOf(t.color)}
                        >
                          {t.name}
                        </span>
                      ))}
                    </span>
                  )}

                  {!isEditingText && (
                    <div className="task-item-trailing">
                      {task.plannedStart && (
                        <span className="task-planned-chip" title={t('taskList.plannedStartTitle')}>
                          🕐 {task.plannedStart}
                        </span>
                      )}
                      {checklistText && (
                        <span
                          className={checklistDone ? 'task-checklist-chip is-done' : 'task-checklist-chip'}
                          title={t('taskList.checklistChipTitle')}
                        >
                          ☑ {checklistText}
                        </span>
                      )}
                      {ageLabel && (
                        <span className="task-age-chip" title={taskAgeTitle(task.createdAt, today, t)}>
                          {ageLabel}
                        </span>
                      )}
                      {task.due && daysBetween(today, task.due) <= DUE_CHIP_WINDOW_DAYS && (
                        <span
                          className={
                            isOverdue(task.due, task.done, today)
                              ? 'task-due-chip overdue'
                              : 'task-due-chip'
                          }
                          title={dueLabel(task.due, today, t, lang)}
                        >
                          {dueChipLabel(task.due, today, t, lang)}
                        </span>
                      )}
                      {timeSummary && (
                        <span
                          className={timeSummary.over ? 'task-total over' : 'task-total'}
                          title={
                            task.estimateMinutes != null
                              ? t('taskList.estimateVsLogged') + (timeSummary.over ? t('taskList.overBudget') : '')
                              : undefined
                          }
                        >
                          {timeSummary.text}
                        </span>
                      )}
                      <TaskRowMenu
                        onEdit={() => startEditTask(task)}
                        onDelete={() => setPendingTaskDelete(task)}
                        onSendToInbox={
                          task.sessions.length === 0 ? () => onSendToInbox(task) : undefined
                        }
                        onStartSelect={() => onStartSelect(task.id)}
                        disabled={disableEdit}
                        editDisabled={isBusy}
                        isSet={Boolean(
                          task.priority ||
                            task.notes ||
                            task.due ||
                            task.estimateMinutes != null ||
                            task.plannedStart ||
                            task.tagIds.length > 0 ||
                            task.checklist.length > 0
                        )}
                        previousWeekLabel={previousWeekLabel}
                        nextWeekLabel={nextWeekLabel}
                        fileId={fileId}
                        onMove={(target) => onMoveTask(task, target)}
                      />
                    </div>
                  )}
                </div>

                {isEditingText && (
                  <TaskDetails
                    task={task}
                    allTags={allTags}
                    disabled={isBusy}
                    onChange={(patch) => onTaskUpdated(task.id, patch)}
                    onManageTags={onManageTags}
                  />
                )}

                <div className="session-area">
                  {task.sessions.length > 0 && (
                    <ul className="session-list">
                      {task.sessions.map((s) => {
                        const isEditingSession = editingSessionId === s.id;
                        const editOverlap = isEditingSession
                          ? findOverlap(tasks, s.id, sessionDraft.start, sessionDraft.end)
                          : null;
                        return (
                          <li key={s.id}>
                            {isEditingSession ? (
                              <>
                                <div className="session-edit-form">
                                  <input
                                    type="text"
                                    placeholder={t('session.durationPlaceholder')}
                                    className="session-edit-duration"
                                    value={sessionDraft.duration}
                                    onChange={(e) => handleSessionDurationChange(e.target.value)}
                                    disabled={savingSession}
                                    autoFocus
                                  />
                                  <span>(</span>
                                  <input
                                    type="text"
                                    placeholder="HH:MM"
                                    className="session-edit-time"
                                    value={sessionDraft.start}
                                    onChange={(e) => handleSessionStartChange(e.target.value)}
                                    disabled={savingSession}
                                  />
                                  <span>–</span>
                                  <input
                                    type="text"
                                    placeholder="HH:MM"
                                    className="session-edit-time"
                                    value={sessionDraft.end}
                                    onChange={(e) => setSessionDraft((d) => ({ ...d, end: e.target.value }))}
                                    disabled={savingSession}
                                    title={t('session.endHint')}
                                  />
                                  <span>)</span>
                                  <button
                                    type="button"
                                    className="session-delete"
                                    onClick={() => void submitSessionEdit(task.id, s.id)}
                                    disabled={savingSession}
                                    aria-label={t('session.save')}
                                    title={t('common.save')}
                                  >
                                    ✓
                                  </button>
                                  <button
                                    type="button"
                                    className="session-delete"
                                    onClick={() => setEditingSessionId(null)}
                                    disabled={savingSession}
                                    aria-label={t('session.cancelEdit')}
                                    title={t('common.cancel')}
                                  >
                                    ×
                                  </button>
                                </div>
                                {editOverlap && (
                                  <p className="warning">
                                    {t('session.overlap', {
                                      name: editOverlap.task.name || t('taskList.noText'),
                                      start: editOverlap.session.start,
                                      end: editOverlap.session.end,
                                    })}
                                  </p>
                                )}
                              </>
                            ) : (
                              <>
                                <span>
                                  ⏱ {formatDurationLabel(s.durationSeconds)} ({s.start}–{s.end})
                                </span>
                                <span className="session-row-actions">
                                  <button
                                    type="button"
                                    className="session-delete"
                                    aria-label={t('session.edit')}
                                    title={t('session.edit')}
                                    onClick={() => startEditSession(s)}
                                  >
                                    ✎
                                  </button>
                                  <button
                                    type="button"
                                    className="session-delete"
                                    aria-label={t('session.delete')}
                                    title={t('session.delete')}
                                    onClick={() => setPendingDelete({ taskId: task.id, sessionId: s.id })}
                                  >
                                    ×
                                  </button>
                                </span>
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {manualEntryTaskId === task.id ? (
                    <>
                      <div className="manual-session-form">
                        <input
                          type="text"
                          placeholder={t('session.durationPlaceholder')}
                          className="session-edit-duration"
                          value={manualDraft.duration}
                          onChange={(e) => handleManualDurationChange(e.target.value)}
                          disabled={addingManualSession}
                          autoFocus
                        />
                        <input
                          type="text"
                          placeholder="HH:MM"
                          className="session-edit-time"
                          value={manualDraft.start}
                          onChange={(e) => handleManualStartChange(e.target.value)}
                          disabled={addingManualSession}
                        />
                        <span>–</span>
                        <input
                          type="text"
                          placeholder="HH:MM"
                          className="session-edit-time"
                          value={manualDraft.end}
                          onChange={(e) => setManualDraft((d) => ({ ...d, end: e.target.value }))}
                          disabled={addingManualSession}
                          title={t('session.endHint')}
                        />
                        <button
                          type="button"
                          className="btn btn-tinted btn-small"
                          onClick={() => void submitManualEntry(task)}
                          disabled={addingManualSession}
                        >
                          {addingManualSession ? t('common.saving') : t('common.save')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-plain btn-small"
                          onClick={() => setManualEntryTaskId(null)}
                          disabled={addingManualSession}
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                      {manualOverlap && (
                        <p className="warning">
                          {t('session.overlap', {
                            name: manualOverlap.task.name || t('taskList.noText'),
                            start: manualOverlap.session.start,
                            end: manualOverlap.session.end,
                          })}
                        </p>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      className="manual-session-trigger"
                      onClick={() => openManualEntry(task)}
                    >
                      {t('session.addManual')}
                    </button>
                  )}
                </div>
              </li>
            );
          })
        )}
      </ul>

      <form className="task-add-form" onSubmit={handleAddSubmit}>
        <input
          type="text"
          value={newTaskText}
          onChange={(e) => setNewTaskText(e.target.value)}
          onKeyDown={handleAddKeyDown}
          placeholder={t('taskList.addPlaceholder')}
          disabled={adding}
        />
        <button type="submit" className="btn btn-tinted" disabled={adding || !newTaskText.trim()}>
          {adding ? t('common.adding') : t('common.add')}
        </button>
      </form>
      {addError && <p className="error">{addError}</p>}

      {error && <p className="error">{error}</p>}

      {pendingDelete && (
        <ConfirmDialog
          title={t('session.deleteTitle')}
          message={t('session.deleteBody')}
          confirmLabel={deleting ? t('common.deleting') : t('common.delete')}
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingTaskDelete && (
        <ConfirmDialog
          title={t('taskList.deleteTaskTitle')}
          message={
            pendingTaskDelete.sessions.length > 0
              ? t('taskList.deleteWithSessions', {
                  count: pendingTaskDelete.sessions.length,
                  total: formatDurationLabel(sumSeconds(pendingTaskDelete)),
                })
              : t('taskList.deleteSimple')
          }
          confirmLabel={deletingTask ? t('common.deleting') : t('common.delete')}
          destructive
          onConfirm={confirmDeleteTask}
          onCancel={() => setPendingTaskDelete(null)}
        />
      )}
    </>
  );
}
