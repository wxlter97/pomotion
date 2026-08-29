import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  applyRecurring,
  createTask,
  deleteTask,
  ensureRecurringSection,
  getRecurringTasks,
  reorderTask,
  updateTaskText,
  UnauthorizedError,
  type RecurringTask,
} from '../api';
import { computeAfterBlockId } from '../taskReorder';
import ConfirmDialog from './ConfirmDialog';

type Section = { containerId: string; headingBlockId: string | null };

export default function RecurringTasksDialog({
  fileId,
  currentWeek,
  onClose,
  onApplied,
}: {
  fileId: string | null;
  /** Semana visible ahora — a la que apunta "Aplicar a esta semana". */
  currentWeek: string | null;
  onClose: () => void;
  onApplied: (added: number) => void;
}) {
  const [tasks, setTasks] = useState<RecurringTask[]>([]);
  const [section, setSection] = useState<Section | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newText, setNewText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [pendingDelete, setPendingDelete] = useState<RecurringTask | null>(null);

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
        const res = await getRecurringTasks(fileId ?? undefined);
        if (cancelled) return;
        setTasks(res.tasks);
        setSection({ containerId: res.containerId, headingBlockId: res.headingBlockId });
      } catch (err) {
        if (cancelled) return;
        setError(errMessage(err, 'No se pudieron cargar las tareas recurrentes'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  const hasSection = Boolean(section?.headingBlockId);
  const anchorFor = (): string | null => {
    if (tasks.length > 0) return tasks[tasks.length - 1].blockId;
    return section?.headingBlockId ?? null;
  };

  async function handleCreateSection() {
    setBusy(true);
    setError(null);
    try {
      const res = await ensureRecurringSection(fileId ?? undefined);
      setSection({ containerId: res.containerId, headingBlockId: res.headingBlockId });
    } catch (err) {
      setError(errMessage(err, 'No se pudo crear la sección'));
    } finally {
      setBusy(false);
    }
  }

  async function submitNew(e: FormEvent) {
    e.preventDefault();
    const text = newText.trim();
    const container = section?.containerId;
    const anchor = anchorFor();
    if (!text || !container || !anchor) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createTask(container, anchor, text);
      setTasks((prev) => [...prev, res.task]);
      setNewText('');
    } catch (err) {
      setError(errMessage(err, 'No se pudo agregar la tarea recurrente'));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(task: RecurringTask) {
    setEditingId(task.blockId);
    setEditingText(task.text);
  }

  async function submitEdit(task: RecurringTask) {
    const text = editingText.trim();
    if (!text || text === task.text) {
      setEditingId(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateTaskText(task.blockId, text);
      setTasks((prev) => prev.map((t) => (t.blockId === task.blockId ? { ...t, text } : t)));
      setEditingId(null);
    } catch (err) {
      setError(errMessage(err, 'No se pudo actualizar la tarea recurrente'));
    } finally {
      setBusy(false);
    }
  }

  function onEditKeyDown(e: KeyboardEvent<HTMLInputElement>, task: RecurringTask) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitEdit(task);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditingId(null);
    }
  }

  async function confirmDelete() {
    const task = pendingDelete;
    if (!task) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTask(task.blockId);
      setTasks((prev) => prev.filter((t) => t.blockId !== task.blockId));
      setPendingDelete(null);
    } catch (err) {
      setError(errMessage(err, 'No se pudo eliminar la tarea recurrente'));
    } finally {
      setBusy(false);
    }
  }

  async function move(task: RecurringTask, targetIndex: number) {
    if (!section?.headingBlockId) return;
    const from = tasks.findIndex((t) => t.blockId === task.blockId);
    if (from === -1 || targetIndex < 0 || targetIndex >= tasks.length) return;
    const afterBlockId = computeAfterBlockId(tasks, task.blockId, targetIndex, section.headingBlockId);
    const original = tasks;
    const reordered = [...tasks];
    reordered.splice(from, 1);
    reordered.splice(targetIndex, 0, task);
    setTasks(reordered);
    setBusy(true);
    setError(null);
    try {
      const res = await reorderTask(task.blockId, section.containerId, afterBlockId);
      // reorderTask recrea el bloque: hay que quedarse con el id nuevo.
      setTasks((prev) => prev.map((t) => (t.blockId === task.blockId ? { ...t, blockId: res.newBlockId } : t)));
    } catch (err) {
      setTasks(original);
      setError(errMessage(err, 'No se pudo reordenar'));
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    if (!currentWeek) return;
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
          Tareas que se repiten todos los días. Viven en la sección «Recurrentes» de tu página de
          Notion; «Aplicar» las agrega a los días de la semana que falten, sin duplicar.
        </p>

        {loading ? (
          <p className="muted">Cargando…</p>
        ) : !hasSection ? (
          <div className="recurring-empty">
            <p>
              Todavía no hay una sección «Recurrentes» en esta página de Notion. Créala (queda encima
              de las semanas) y agrega tus tareas.
            </p>
            <button type="button" className="btn btn-filled" onClick={() => void handleCreateSection()} disabled={busy}>
              {busy ? 'Creando…' : 'Crear sección «Recurrentes»'}
            </button>
          </div>
        ) : (
          <>
            {tasks.length === 0 ? (
              <p className="muted">No hay tareas recurrentes todavía.</p>
            ) : (
              <ul className="recurring-list">
                {tasks.map((task, i) => (
                  <li key={task.blockId}>
                    {editingId === task.blockId ? (
                      <div className="recurring-edit">
                        <input
                          type="text"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onKeyDown={(e) => onEditKeyDown(e, task)}
                          disabled={busy}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="btn btn-icon"
                          onClick={() => void submitEdit(task)}
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
                        <span className="recurring-text">{task.text}</span>
                        <div className="recurring-actions">
                          <button
                            type="button"
                            className="task-move"
                            onClick={() => startEdit(task)}
                            disabled={busy}
                            aria-label="Editar"
                            title="Editar"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="task-move"
                            onClick={() => void move(task, i - 1)}
                            disabled={busy || i === 0}
                            aria-label="Mover arriba"
                            title="Mover arriba"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="task-move"
                            onClick={() => void move(task, i + 1)}
                            disabled={busy || i === tasks.length - 1}
                            aria-label="Mover abajo"
                            title="Mover abajo"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="task-delete"
                            onClick={() => setPendingDelete(task)}
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
                placeholder="Agregar tarea recurrente…"
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
          {hasSection && (
            <button
              type="button"
              className="btn btn-filled"
              onClick={() => void handleApply()}
              disabled={busy || !currentWeek || tasks.length === 0}
              title={currentWeek ? `Aplicar a ${currentWeek}` : 'No hay una semana visible'}
            >
              {busy ? 'Aplicando…' : 'Aplicar a esta semana'}
            </button>
          )}
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar tarea recurrente"
          message={`Se quita "${pendingDelete.text}" de la lista de recurrentes. Las tareas que ya se hayan agregado a algún día no se tocan.`}
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
  if (err instanceof UnauthorizedError) return 'La sesión expiró. Recargá la página para volver a entrar.';
  return err instanceof Error ? err.message : fallback;
}
