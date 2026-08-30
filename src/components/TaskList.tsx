import { useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
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
import type { DayColumn, Session, Tag, Task } from '../types';
import {
  daysBetween,
  dueChipLabel,
  dueLabel,
  isOverdue,
  taskAgeLabel,
  taskAgeTitle,
  taskTimeSummary,
} from '../taskMeta';
import { resolveTags, tagColorOf } from '../tags';

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
  selectedDay,
  selectedDate,
  today,
  days,
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
  onReorderTask,
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
  selectedDay: string;
  selectedDate: string;
  today: string;
  days: DayColumn[];
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
  onTaskDeleted: (id: string) => void;
  onTaskTextUpdated: (id: string, name: string) => void;
  onTaskUpdated: (id: string, patch: Partial<Task>) => void;
  onReorderTask: (task: Task, targetIndex: number) => void;
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

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la sesión');
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
      onTaskDeleted(pendingTaskDelete.id);
      setPendingTaskDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la tarea');
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
      setAddError(err instanceof Error ? err.message : 'No se pudo crear la tarea');
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

  function handleDragStart(e: DragEvent<HTMLLIElement>, id: string) {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id); // Firefox exige setData para iniciar el drag
  }

  function handleDragOver(e: DragEvent<HTMLLIElement>, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) setDragOverIndex(index);
  }

  function handleDrop(e: DragEvent<HTMLLIElement>, index: number) {
    e.preventDefault();
    const id = dragId;
    setDragId(null);
    setDragOverIndex(null);
    if (!id) return;
    const task = tasks.find((t) => t.id === id);
    if (task) onReorderTask(task, index);
  }

  function handleDragEnd() {
    setDragId(null);
    setDragOverIndex(null);
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
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la tarea');
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
      setError('La duración debe ser un número mayor a 0 o un formato tipo "1h 30m 45s"');
      return null;
    }
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
      setError('Las horas deben tener formato HH:MM');
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
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la sesión');
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
      setError(err instanceof Error ? err.message : 'No se pudo agregar la sesión');
    } finally {
      setAddingManualSession(false);
    }
  }

  const selectMode = selectedIds.size > 0;

  return (
    <>
      {tasks.length === 0 ? (
        <p className="muted">No hay tareas para este día.</p>
      ) : (
        <ul className="task-list">
          {tasks.map((task, i) => {
            const total = sumSeconds(task);
            const timeSummary = taskTimeSummary(total, task.estimateMinutes);
            const taskTags = resolveTags(task.tagIds, allTags);
            // Chip de "lleva mucho abierta": solo en tareas sin hacer y que no
            // sean de un día futuro (planificar a futuro no es estar estancado).
            const ageLabel =
              !task.done && selectedDate <= today
                ? taskAgeLabel(task.createdAt, today)
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
                draggable={canReorder && !disableEdit && !isEditingText && !selectMode}
                onDragStart={(e) => handleDragStart(e, task.id)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={(e) => handleDrop(e, i)}
                onDragEnd={handleDragEnd}
                className={dragOverIndex === i && dragId && dragId !== task.id ? 'drag-over' : ''}
              >
                <div
                  className={[
                    'task-item',
                    task.id === selectedTaskId && !selectMode ? 'active' : '',
                    isLocked ? 'locked' : '',
                    selectMode ? 'is-selecting' : '',
                    isSelected ? 'is-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-priority={task.priority ?? undefined}
                  title={isLocked ? 'Detén el timer para mover o borrar esta tarea' : undefined}
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
                          ? 'Quitar de la selección'
                          : 'Agregar a la selección'
                        : task.done
                          ? 'Marcar como pendiente'
                          : 'Marcar como hecha'
                    }
                    title={
                      selectMode
                        ? 'Seleccionar'
                        : task.done
                          ? 'Marcar como pendiente'
                          : 'Marcar como hecha'
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
                        aria-label="Guardar"
                        title="Guardar"
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className="btn btn-icon"
                        onClick={() => setEditingTaskId(null)}
                        disabled={savingTaskText}
                        aria-label="Cancelar"
                        title="Cancelar"
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
                        <span className="task-src" title="Del calendario" aria-label="Del calendario">
                          📅
                        </span>
                      )}
                      <span className="task-text">{task.name || '(sin texto)'}</span>
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
                      {ageLabel && (
                        <span className="task-age-chip" title={taskAgeTitle(task.createdAt, today)}>
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
                          title={dueLabel(task.due, today)}
                        >
                          {dueChipLabel(task.due, today)}
                        </span>
                      )}
                      {timeSummary && (
                        <span
                          className={timeSummary.over ? 'task-total over' : 'task-total'}
                          title={
                            task.estimateMinutes != null
                              ? `Registrado vs. estimado${timeSummary.over ? ' — te pasaste' : ''}`
                              : undefined
                          }
                        >
                          {timeSummary.text}
                        </span>
                      )}
                      <TaskRowMenu
                        onEdit={() => startEditTask(task)}
                        onMoveUp={() => onReorderTask(task, i - 1)}
                        onMoveDown={() => onReorderTask(task, i + 1)}
                        canMoveUp={canReorder && i > 0}
                        canMoveDown={canReorder && i < tasks.length - 1}
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
                            task.tagIds.length > 0
                        )}
                        currentDay={selectedDay}
                        days={days}
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
                                    placeholder="90 o 1h 30m"
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
                                    title="Se calcula a partir de inicio + duración, pero puedes editarla"
                                  />
                                  <span>)</span>
                                  <button
                                    type="button"
                                    className="session-delete"
                                    onClick={() => void submitSessionEdit(task.id, s.id)}
                                    disabled={savingSession}
                                    aria-label="Guardar sesión"
                                    title="Guardar"
                                  >
                                    ✓
                                  </button>
                                  <button
                                    type="button"
                                    className="session-delete"
                                    onClick={() => setEditingSessionId(null)}
                                    disabled={savingSession}
                                    aria-label="Cancelar edición"
                                    title="Cancelar"
                                  >
                                    ×
                                  </button>
                                </div>
                                {editOverlap && (
                                  <p className="warning">
                                    ⚠ Se solapa con "{editOverlap.task.name || '(sin texto)'}" (
                                    {editOverlap.session.start}–{editOverlap.session.end})
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
                                    aria-label="Editar sesión"
                                    title="Editar sesión"
                                    onClick={() => startEditSession(s)}
                                  >
                                    ✎
                                  </button>
                                  <button
                                    type="button"
                                    className="session-delete"
                                    aria-label="Eliminar sesión"
                                    title="Eliminar sesión"
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
                          placeholder="90 o 1h 30m"
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
                          title="Se calcula a partir de inicio + duración, pero puedes editarla"
                        />
                        <button
                          type="button"
                          className="btn btn-tinted btn-small"
                          onClick={() => void submitManualEntry(task)}
                          disabled={addingManualSession}
                        >
                          {addingManualSession ? 'Guardando…' : 'Guardar'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-plain btn-small"
                          onClick={() => setManualEntryTaskId(null)}
                          disabled={addingManualSession}
                        >
                          Cancelar
                        </button>
                      </div>
                      {manualOverlap && (
                        <p className="warning">
                          ⚠ Se solapa con "{manualOverlap.task.name || '(sin texto)'}" (
                          {manualOverlap.session.start}–{manualOverlap.session.end})
                        </p>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      className="manual-session-trigger"
                      onClick={() => openManualEntry(task)}
                    >
                      + Agregar sesión manual
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form className="task-add-form" onSubmit={handleAddSubmit}>
        <input
          type="text"
          value={newTaskText}
          onChange={(e) => setNewTaskText(e.target.value)}
          onKeyDown={handleAddKeyDown}
          placeholder="Agregar tarea…"
          disabled={adding}
        />
        <button type="submit" className="btn btn-tinted" disabled={adding || !newTaskText.trim()}>
          {adding ? 'Agregando…' : 'Agregar'}
        </button>
      </form>
      {addError && <p className="error">{addError}</p>}

      {error && <p className="error">{error}</p>}

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar sesión"
          message="Esto borra el registro de tiempo. No se puede deshacer."
          confirmLabel={deleting ? 'Eliminando…' : 'Eliminar'}
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingTaskDelete && (
        <ConfirmDialog
          title="Eliminar tarea"
          message={
            pendingTaskDelete.sessions.length > 0
              ? `Esta tarea tiene ${pendingTaskDelete.sessions.length} sesión(es) registradas (${formatDurationLabel(
                  sumSeconds(pendingTaskDelete)
                )}). Borrarla también borra ese historial. No se puede deshacer.`
              : 'Esto borra la tarea. No se puede deshacer.'
          }
          confirmLabel={deletingTask ? 'Eliminando…' : 'Eliminar'}
          destructive
          onConfirm={confirmDeleteTask}
          onCancel={() => setPendingTaskDelete(null)}
        />
      )}
    </>
  );
}
