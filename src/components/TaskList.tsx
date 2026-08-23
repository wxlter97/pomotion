import type { Task } from '../types';

function sumMinutes(task: Task): number {
  return task.sessions.reduce((total, s) => total + s.durationMinutes, 0);
}

export default function TaskList({
  tasks,
  selectedBlockId,
  onSelect,
}: {
  tasks: Task[];
  selectedBlockId: string | null;
  onSelect: (task: Task) => void;
}) {
  if (tasks.length === 0) {
    return <p className="muted">No hay tareas para este día.</p>;
  }

  return (
    <ul className="task-list">
      {tasks.map((task) => {
        const total = sumMinutes(task);
        return (
          <li key={task.blockId}>
            <button
              type="button"
              className={
                task.blockId === selectedBlockId ? 'task-item active' : 'task-item'
              }
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
                  <li key={i}>
                    ⏱ {s.durationMinutes}m ({s.start}–{s.end})
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
