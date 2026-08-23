import { useState } from 'react';
import { deleteSession } from '../api';
import type { Task } from '../types';
import ConfirmDialog from './ConfirmDialog';

function sumMinutes(task: Task): number {
  return task.sessions.reduce((total, s) => total + s.durationMinutes, 0);
}

export default function TaskList({
  tasks,
  selectedBlockId,
  onSelect,
  onSessionDeleted,
}: {
  tasks: Task[];
  selectedBlockId: string | null;
  onSelect: (task: Task) => void;
  onSessionDeleted: (taskBlockId: string, sessionBlockId: string) => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<{ taskBlockId: string; sessionBlockId: string } | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (tasks.length === 0) {
    return <p className="muted">No hay tareas para este día.</p>;
  }

  return (
    <>
      <ul className="task-list">
        {tasks.map((task) => {
          const total = sumMinutes(task);
          return (
            <li key={task.blockId}>
              <button
                type="button"
                className={task.blockId === selectedBlockId ? 'task-item active' : 'task-item'}
                onClick={() => onSelect(task)}
              >
                <span className={task.checked ? 'task-check checked' : 'task-check'}>
                  {task.checked ? '✓' : ''}
                </span>
                <span className="task-text">{task.text || '(sin texto)'}</span>
                {total > 0 && <span className="task-total">{total}m</span>}
              </button>
              {task.sessions.length > 0 && (
                <ul className="session-list">
                  {task.sessions.map((s, i) => (
                    <li key={s.blockId ?? i}>
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
    </>
  );
}
