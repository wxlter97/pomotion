import { useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import { createTask, deleteSession, deleteTask } from '../api';
import type { Task } from '../types';
import ConfirmDialog from './ConfirmDialog';

function sumMinutes(task: Task): number {
  return task.sessions.reduce((total, s) => total + s.durationMinutes, 0);
}

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
  onReorderTask,
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
  onReorderTask: (task: Task, targetIndex: number) => void;
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

            return (
              <li
                key={task.blockId}
                draggable={!disableEdit}
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
                  <button type="button" className="task-select" onClick={() => onSelect(task)}>
                    <span className="task-text">{task.text || '(sin texto)'}</span>
                  </button>
                  {total > 0 && <span className="task-total">{total}m</span>}
                  <div className="task-actions">
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
                </div>
                {task.sessions.length > 0 && (
                  <ul className="session-list">
                    {task.sessions.map((s, si) => (
                      <li key={s.blockId ?? si}>
                        <span>
                          ⏱ {s.durationMinutes}m ({s.start}–{s.end})
                        </span>
                        {s.blockId && (
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
                        )}
                      </li>
                    ))}
                  </ul>
                )}
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
