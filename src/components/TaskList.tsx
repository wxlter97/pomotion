import { useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import {
  createTask,
  deleteSession,
  deleteTask,
  postManualSession,
  updateSession,
  updateTaskText,
} from '../api';
import type { Session, Task } from '../types';
import ConfirmDialog from './ConfirmDialog';

const TIME_RE = /^\d{1,2}:\d{2}$/;

function sumMinutes(task: Task): number {
  return task.sessions.reduce((total, s) => total + s.durationMinutes, 0);
}

type SessionDraft = { duration: string; start: string; end: string };

export default function TaskList({
  tasks,
  selectedBlockId,
  onSelect,
  onToggleChecked,
  togglingIds,
  onSessionDeleted,
  dayContainerId,
  dayHeadingBlockId,
  lockedTaskBlockId,
  busyTaskIds,
  onTaskCreated,
  onTaskDeleted,
  onTaskTextUpdated,
  onReorderTask,
  onSessionUpdated,
  onManualSessionAdded,
}: {
  tasks: Task[];
  selectedBlockId: string | null;
  onSelect: (task: Task) => void;
  onToggleChecked: (task: Task) => void;
  togglingIds: Set<string>;
  onSessionDeleted: (taskBlockId: string, sessionBlockId: string) => void;
  dayContainerId: string | null;
  dayHeadingBlockId: string | null;
  lockedTaskBlockId: string | null;
  busyTaskIds: Set<string>;
  onTaskCreated: (task: { blockId: string; text: string; checked: boolean }) => void;
  onTaskDeleted: (blockId: string) => void;
  onTaskTextUpdated: (blockId: string, text: string) => void;
  onReorderTask: (task: Task, targetIndex: number) => void;
  onSessionUpdated: (taskBlockId: string, session: Session) => void;
  onManualSessionAdded: (taskBlockId: string, session: Session) => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<{ taskBlockId: string; sessionBlockId: string } | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pendingTaskDelete, setPendingTaskDelete] = useState<Task | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);

  const [newTaskText, setNewTaskText] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [dragBlockId, setDragBlockId] = useState<string | null>(null);
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
      await deleteSession(pendingDelete.sessionBlockId);
      onSessionDeleted(pendingDelete.taskBlockId, pendingDelete.sessionBlockId);
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
      await deleteTask(pendingTaskDelete.blockId);
      onTaskDeleted(pendingTaskDelete.blockId);
      setPendingTaskDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la tarea');
    } finally {
      setDeletingTask(false);
    }
  }

  async function submitAdd() {
    const trimmed = newTaskText.trim();
    const afterBlockId = tasks.length > 0 ? tasks[tasks.length - 1].blockId : dayHeadingBlockId;
    if (!trimmed || !dayContainerId || !afterBlockId) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await createTask(dayContainerId, afterBlockId, trimmed);
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

  // No depender solo del submit implícito del navegador al presionar Enter
  // (misma lección que Login.tsx) — se maneja explícito y se cancela el
  // default para no disparar el submit del form dos veces.
  function handleAddKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitAdd();
    }
  }

  function handleDragStart(e: DragEvent<HTMLLIElement>, blockId: string) {
    setDragBlockId(blockId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', blockId); // Firefox exige setData para iniciar el drag
  }

  function handleDragOver(e: DragEvent<HTMLLIElement>, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) setDragOverIndex(index);
  }

  function handleDrop(e: DragEvent<HTMLLIElement>, index: number) {
    e.preventDefault();
    const blockId = dragBlockId;
    setDragBlockId(null);
    setDragOverIndex(null);
    if (!blockId) return;
    const task = tasks.find((t) => t.blockId === blockId);
    if (task) onReorderTask(task, index);
  }

  function handleDragEnd() {
    setDragBlockId(null);
    setDragOverIndex(null);
  }

  function startEditTask(task: Task) {
    setEditingTaskId(task.blockId);
    setEditingTaskText(task.text);
  }

  async function submitTaskTextEdit(task: Task) {
    const trimmed = editingTaskText.trim();
    if (!trimmed) return;
    if (trimmed === task.text) {
      setEditingTaskId(null);
      return;
    }
    setSavingTaskText(true);
    setError(null);
    try {
      await updateTaskText(task.blockId, trimmed);
      onTaskTextUpdated(task.blockId, trimmed);
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
    if (!s.blockId) return;
    setEditingSessionId(s.blockId);
    setSessionDraft({ duration: String(s.durationMinutes), start: s.start, end: s.end });
  }

  function validateDraft(draft: SessionDraft): { duration: number; start: string; end: string } | null {
    const duration = Number(draft.duration);
    const start = draft.start.trim();
    const end = draft.end.trim();
    if (!Number.isFinite(duration) || duration <= 0) {
      setError('La duración debe ser un número mayor a 0');
      return null;
    }
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
      setError('Las horas deben tener formato HH:MM');
      return null;
    }
    return { duration, start, end };
  }

  async function submitSessionEdit(taskBlockId: string, sessionBlockId: string) {
    setError(null);
    const parsed = validateDraft(sessionDraft);
    if (!parsed) return;
    setSavingSession(true);
    try {
      const res = await updateSession(sessionBlockId, parsed.duration, parsed.start, parsed.end);
      onSessionUpdated(taskBlockId, { blockId: sessionBlockId, ...res.session });
      setEditingSessionId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la sesión');
    } finally {
      setSavingSession(false);
    }
  }

  function openManualEntry(task: Task) {
    setManualEntryTaskId(task.blockId);
    setManualDraft({ duration: '', start: '', end: '' });
  }

  async function submitManualEntry(task: Task) {
    setError(null);
    const parsed = validateDraft(manualDraft);
    if (!parsed) return;
    setAddingManualSession(true);
    try {
      const res = await postManualSession(task.blockId, parsed.duration, parsed.start, parsed.end);
      onManualSessionAdded(task.blockId, { blockId: res.session.blockId, ...res.session });
      setManualEntryTaskId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo agregar la sesión');
    } finally {
      setAddingManualSession(false);
    }
  }

  return (
    <>
      {tasks.length === 0 ? (
        <p className="muted">No hay tareas para este día.</p>
      ) : (
        <ul className="task-list">
          {tasks.map((task, i) => {
            const total = sumMinutes(task);
            const isToggling = togglingIds.has(task.blockId);
            const isLocked = lockedTaskBlockId === task.blockId;
            const isBusy = busyTaskIds.has(task.blockId);
            const disableEdit = isLocked || isBusy;
            const isEditingText = editingTaskId === task.blockId;

            return (
              <li
                key={task.blockId}
                draggable={!disableEdit && !isEditingText}
                onDragStart={(e) => handleDragStart(e, task.blockId)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={(e) => handleDrop(e, i)}
                onDragEnd={handleDragEnd}
                className={dragOverIndex === i && dragBlockId && dragBlockId !== task.blockId ? 'drag-over' : ''}
              >
                <div
                  className={
                    task.blockId === selectedBlockId ? 'task-item active' : isLocked ? 'task-item locked' : 'task-item'
                  }
                  title={isLocked ? 'Detén el timer para mover o borrar esta tarea' : undefined}
                >
                  <button
                    type="button"
                    className={task.checked ? 'task-check checked' : 'task-check'}
                    onClick={() => onToggleChecked(task)}
                    disabled={isToggling}
                    aria-label={task.checked ? 'Marcar como pendiente' : 'Marcar como hecha'}
                    title={task.checked ? 'Marcar como pendiente' : 'Marcar como hecha'}
                  >
                    {!isToggling && task.checked ? '✓' : ''}
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
                    <button type="button" className="task-select" onClick={() => onSelect(task)}>
                      <span className="task-text">{task.text || '(sin texto)'}</span>
                    </button>
                  )}

                  {total > 0 && <span className="task-total">{total}m</span>}
                  {!isEditingText && (
                    <div className="task-actions">
                      <button
                        type="button"
                        className="task-move"
                        onClick={() => startEditTask(task)}
                        disabled={isBusy}
                        aria-label="Editar tarea"
                        title="Editar texto"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="task-move"
                        onClick={() => onReorderTask(task, i - 1)}
                        disabled={i === 0 || disableEdit}
                        aria-label="Mover arriba"
                        title="Mover arriba"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="task-move"
                        onClick={() => onReorderTask(task, i + 1)}
                        disabled={i === tasks.length - 1 || disableEdit}
                        aria-label="Mover abajo"
                        title="Mover abajo"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="task-delete"
                        onClick={() => setPendingTaskDelete(task)}
                        disabled={disableEdit}
                        aria-label="Eliminar tarea"
                        title="Eliminar tarea"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>

                <div className="session-area">
                  {task.sessions.length > 0 && (
                    <ul className="session-list">
                      {task.sessions.map((s, si) => {
                        const isEditingSession = s.blockId && editingSessionId === s.blockId;
                        return (
                          <li key={s.blockId ?? si}>
                            {isEditingSession ? (
                              <div className="session-edit-form">
                                <input
                                  type="number"
                                  min="1"
                                  className="session-edit-duration"
                                  value={sessionDraft.duration}
                                  onChange={(e) => setSessionDraft((d) => ({ ...d, duration: e.target.value }))}
                                  disabled={savingSession}
                                  autoFocus
                                />
                                <span>m (</span>
                                <input
                                  type="text"
                                  placeholder="HH:MM"
                                  className="session-edit-time"
                                  value={sessionDraft.start}
                                  onChange={(e) => setSessionDraft((d) => ({ ...d, start: e.target.value }))}
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
                                />
                                <span>)</span>
                                <button
                                  type="button"
                                  className="session-delete"
                                  onClick={() => s.blockId && void submitSessionEdit(task.blockId, s.blockId)}
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
                            ) : (
                              <>
                                <span>
                                  ⏱ {s.durationMinutes}m ({s.start}–{s.end})
                                </span>
                                {s.blockId && (
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
                                      onClick={() =>
                                        setPendingDelete({ taskBlockId: task.blockId, sessionBlockId: s.blockId as string })
                                      }
                                    >
                                      ×
                                    </button>
                                  </span>
                                )}
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {manualEntryTaskId === task.blockId ? (
                    <div className="manual-session-form">
                      <input
                        type="number"
                        min="1"
                        placeholder="min"
                        className="session-edit-duration"
                        value={manualDraft.duration}
                        onChange={(e) => setManualDraft((d) => ({ ...d, duration: e.target.value }))}
                        disabled={addingManualSession}
                        autoFocus
                      />
                      <input
                        type="text"
                        placeholder="HH:MM"
                        className="session-edit-time"
                        value={manualDraft.start}
                        onChange={(e) => setManualDraft((d) => ({ ...d, start: e.target.value }))}
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
                  ) : (
                    <button type="button" className="manual-session-trigger" onClick={() => openManualEntry(task)}>
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
          disabled={adding || !dayContainerId}
        />
        <button type="submit" className="btn btn-tinted" disabled={adding || !newTaskText.trim() || !dayContainerId}>
          {adding ? 'Agregando…' : 'Agregar'}
        </button>
      </form>
      {addError && <p className="error">{addError}</p>}

      {error && <p className="error">{error}</p>}

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar sesión"
          message="Esto borra el registro de tiempo en Notion. No se puede deshacer."
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
              ? `Esta tarea tiene ${pendingTaskDelete.sessions.length} sesión(es) registradas (${sumMinutes(
                  pendingTaskDelete
                )}m). Borrarla también borra ese historial. No se puede deshacer.`
              : 'Esto borra la tarea en Notion. No se puede deshacer.'
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
