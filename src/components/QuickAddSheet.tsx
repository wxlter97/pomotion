import { useRef, useState, type FormEvent } from 'react';
import { createTask } from '../api';
import { useT } from '../i18n';
import type { Task } from '../types';

/**
 * Sheet de alta rápida — la acción del FAB / "+ Nueva tarea" de la
 * sidebar. Misma llamada que el form inline al pie de TaskList
 * (`createTask` + `onCreated`), solo que accesible desde cualquier
 * pestaña (Hoy/Agenda) sin tener que buscar la fila al final de la lista.
 */
export default function QuickAddSheet({
  date,
  fileId,
  onCreated,
  onClose,
}: {
  date: string;
  fileId: string | null;
  onCreated: (task: Task) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setAdding(true);
    setError(null);
    try {
      const res = await createTask(date, trimmed, fileId ?? undefined);
      onCreated(res.task);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('taskList.createError'));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-add-title"
        onClick={(e) => e.stopPropagation()}
        // El input arranca fuera de pantalla (el sheet mobile hace
        // slide-up con transform) — pedirle foco antes de que termine la
        // animación hace que iOS/Android descarten el teclado en vez de
        // mostrarlo. Esperamos a que la animación de entrada del propio
        // .sheet termine para recién ahí enfocar.
        onAnimationEnd={() => inputRef.current?.focus()}
      >
        <h2 id="quick-add-title">{t('quickAdd.title')}</h2>
        <form className="quick-add-form" onSubmit={(e) => void submit(e)}>
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('quickAdd.placeholder')}
            disabled={adding}
          />
          {error && <p className="error">{error}</p>}
          <div className="sheet-actions">
            <button type="button" className="btn btn-plain" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-filled" disabled={adding || !text.trim()}>
              {adding ? t('common.adding') : t('common.add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
