import { useState } from 'react';
import { updateTaskFields, UnauthorizedError } from '../api';
import { PRIORITY_OPTIONS } from '../taskMeta';
import type { Task, TaskPriority } from '../types';

type Fields = { priority?: TaskPriority | null; notes?: string | null; due?: string | null };

/** Panel expandible bajo una tarea: prioridad, vencimiento y notas. */
export default function TaskDetails({
  task,
  onChange,
  disabled,
}: {
  task: Task;
  onChange: (patch: Fields) => void;
  disabled?: boolean;
}) {
  const [notes, setNotes] = useState(task.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(fields: Fields) {
    setSaving(true);
    setError(null);
    try {
      await updateTaskFields(task.id, fields);
      onChange(fields);
    } catch (err) {
      setError(
        err instanceof UnauthorizedError
          ? 'La sesión expiró. Recargá la página para volver a entrar.'
          : err instanceof Error
            ? err.message
            : 'No se pudo guardar'
      );
    } finally {
      setSaving(false);
    }
  }

  function commitNotes() {
    const trimmed = notes.trim();
    if (trimmed === (task.notes ?? '')) return;
    void save({ notes: trimmed || null });
  }

  const busy = disabled || saving;

  return (
    <div className="task-details">
      <div className="task-details-row">
        <span className="task-details-label">Prioridad</span>
        <div className="priority-pills">
          {PRIORITY_OPTIONS.map((p) => (
            <button
              key={p.level}
              type="button"
              className={`priority-pill p-${p.level}${task.priority === p.level ? ' on' : ''}`}
              onClick={() => void save({ priority: task.priority === p.level ? null : p.level })}
              disabled={busy}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="task-details-row">
        <span className="task-details-label">Vence</span>
        <input
          type="date"
          className="task-due-input"
          value={task.due ?? ''}
          onChange={(e) => void save({ due: e.target.value || null })}
          disabled={busy}
        />
        {task.due && (
          <button
            type="button"
            className="btn btn-plain btn-small"
            onClick={() => void save({ due: null })}
            disabled={busy}
          >
            Quitar
          </button>
        )}
      </div>

      <textarea
        className="task-notes-input"
        placeholder="Notas…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={commitNotes}
        disabled={busy}
        rows={2}
      />

      {error && <p className="error">{error}</p>}
    </div>
  );
}
