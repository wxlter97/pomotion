import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createInboxTask, deleteTask, updateTaskText } from '../api';
import type { Task } from '../types';
import ConfirmDialog from './ConfirmDialog';
import Menu, { MenuItem } from './Menu';
import { useDrag } from '../drag/DragProvider';

const COLLAPSED_KEY = 'pomotion:inbox-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function ChevronIcon() {
  return (
    <svg
      className="inbox-chevron"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/**
 * Inbox / backlog: tareas sin fecha. Un cajón plegable arriba de la agenda
 * del día para anotar pendientes y programarlos a un día cuando toque.
 */
export default function Inbox({
  tasks,
  fileId,
  onCreated,
  onDeleted,
  onTextUpdated,
}: {
  tasks: Task[];
  fileId: string | null;
  onCreated: (task: Task) => void;
  onDeleted: (id: string) => void;
  onTextUpdated: (id: string, name: string) => void;
}) {
  const { beginDrag, draggingId } = useDrag();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // ignorar
    }
  }, [collapsed]);

  async function submitAdd(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setAdding(true);
    setError(null);
    try {
      const res = await createInboxTask(trimmed, fileId ?? undefined);
      onCreated(res.task);
      setText('');
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo anotar');
    } finally {
      setAdding(false);
    }
  }

  function startEdit(task: Task) {
    setEditingId(task.id);
    setEditingText(task.name);
  }

  async function commitEdit(task: Task) {
    const trimmed = editingText.trim();
    if (!trimmed || trimmed === task.name) {
      setEditingId(null);
      return;
    }
    setSavingEdit(true);
    setError(null);
    try {
      await updateTaskText(task.id, trimmed);
      onTextUpdated(task.id, trimmed);
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo renombrar');
    } finally {
      setSavingEdit(false);
    }
  }

  function onEditKeyDown(e: KeyboardEvent<HTMLInputElement>, task: Task) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitEdit(task);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditingId(null);
    }
  }

  // Arrastrar una nota a la pestaña de un día la programa; el DragProvider
  // arranca el drag al superar el umbral / mantener presionado.
  function handleItemPointerDown(e: ReactPointerEvent, task: Task) {
    if (editingId === task.id) return;
    const target = e.target as HTMLElement;
    if (target.closest('.menu-wrap, input')) return;
    beginDrag({ kind: 'inbox', task }, e, task.name);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteTask(pendingDelete.id);
      onDeleted(pendingDelete.id);
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section
      className={collapsed ? 'inbox' : 'inbox is-open'}
      data-drag-zone="inbox"
    >
      <button
        type="button"
        className="inbox-header"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <ChevronIcon />
        <span>Sin fecha</span>
        {tasks.length > 0 && <span className="inbox-count">{tasks.length}</span>}
      </button>

      {!collapsed && (
        <div className="inbox-body">
          <form className="task-add-form" onSubmit={submitAdd}>
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Anotar algo para después…"
              disabled={adding}
            />
            <button type="submit" className="btn btn-tinted" disabled={adding || !text.trim()}>
              {adding ? 'Anotando…' : 'Anotar'}
            </button>
          </form>

          {tasks.length === 0 ? (
            <p className="muted inbox-empty">Nada anotado todavía.</p>
          ) : (
            <ul className="inbox-list">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className={draggingId === task.id ? 'inbox-item is-drag-src' : 'inbox-item'}
                  onPointerDown={(e) => handleItemPointerDown(e, task)}
                >
                  {editingId === task.id ? (
                    <input
                      type="text"
                      className="inbox-edit-input"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => onEditKeyDown(e, task)}
                      onBlur={() => void commitEdit(task)}
                      disabled={savingEdit}
                      autoFocus
                    />
                  ) : (
                    <span className="inbox-item-name">{task.name || '(sin texto)'}</span>
                  )}

                  <Menu
                    triggerClassName="task-row-menu-trigger"
                    trigger="⋮"
                    ariaLabel="Acciones de la tarea"
                  >
                    {(close) => (
                      <>
                        <MenuItem
                          onClick={() => {
                            startEdit(task);
                            close();
                          }}
                        >
                          Editar
                        </MenuItem>
                        <MenuItem
                          danger
                          onClick={() => {
                            setPendingDelete(task);
                            close();
                          }}
                        >
                          Eliminar
                        </MenuItem>
                      </>
                    )}
                  </Menu>
                </li>
              ))}
            </ul>
          )}

          {error && <p className="error">{error}</p>}
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar del inbox"
          message="Esto borra la nota. No se puede deshacer."
          confirmLabel={deleting ? 'Eliminando…' : 'Eliminar'}
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </section>
  );
}
