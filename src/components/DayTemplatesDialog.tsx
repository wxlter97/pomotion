import { useEffect, useState, type FormEvent } from 'react';
import {
  applyDayTemplate,
  createDayTemplate,
  deleteDayTemplate,
  updateDayTemplate,
  UnauthorizedError,
} from '../api';
import type { DayTemplate } from '../types';
import ConfirmDialog from './ConfirmDialog';
import { localizeDay, plural, useLang, useT, type TFn } from '../i18n';

function errText(err: unknown, t: TFn): string {
  if (err instanceof UnauthorizedError) return t('goals.sessionExpired');
  return err instanceof Error ? err.message : t('common.somethingWrong');
}

/**
 * Plantillas de día: guardar un set de tareas con nombre y "estamparlo"
 * en el día visible. Tras cualquier cambio llama a `onChanged` (recarga).
 */
export default function DayTemplatesDialog({
  templates,
  selectedDate,
  dayLabel,
  dayTaskCount,
  fileId,
  onChanged,
  onApplied,
  onClose,
}: {
  templates: DayTemplate[];
  /** 'YYYY-MM-DD' del día visible — a donde se estampa. */
  selectedDate: string;
  /** "Lunes", para los textos. */
  dayLabel: string;
  /** Cuántas tareas tiene el día visible (para "copiar de …"). */
  dayTaskCount: number;
  fileId: string | null;
  onChanged: () => void;
  onApplied: (added: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const dayName = localizeDay(dayLabel, lang);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [itemsText, setItemsText] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<DayTemplate | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !editingId && !pendingDelete) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, editingId, pendingDelete]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setBusy(false);
    }
  }

  function createBlank(e: FormEvent) {
    e.preventDefault();
    const items = itemsText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((n) => ({ name: n }));
    if (!name.trim() || items.length === 0) return;
    void run(async () => {
      await createDayTemplate(name.trim(), { items, fileId: fileId ?? undefined });
      setName('');
      setItemsText('');
    });
  }

  function createFromDay() {
    if (!name.trim()) return;
    void run(async () => {
      await createDayTemplate(name.trim(), { fromDate: selectedDate, fileId: fileId ?? undefined });
      setName('');
      setItemsText('');
    });
  }

  async function saveName(tpl: DayTemplate) {
    const next = editingName.trim();
    setEditingId(null);
    if (!next || next === tpl.name) return;
    await run(() => updateDayTemplate(tpl.id, { name: next }));
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const tpl = pendingDelete;
    setPendingDelete(null);
    await run(() => deleteDayTemplate(tpl.id));
  }

  function apply(tpl: DayTemplate) {
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await applyDayTemplate(tpl.id, selectedDate, fileId ?? undefined);
        onApplied(res.added);
        onClose();
      } catch (err) {
        setError(errText(err, t));
        setBusy(false);
      }
    })();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--templates"
        role="dialog"
        aria-modal="true"
        aria-labelledby="templates-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="templates-title">{t('templates.title')}</h2>

        <form className="dt-create" onSubmit={createBlank}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('templates.namePlaceholder')}
            disabled={busy}
            maxLength={60}
          />
          <textarea
            value={itemsText}
            onChange={(e) => setItemsText(e.target.value)}
            placeholder={t('templates.itemsPlaceholder')}
            rows={3}
            disabled={busy}
          />
          <div className="dt-create-actions">
            <button
              type="submit"
              className="btn btn-tinted btn-small"
              disabled={busy || !name.trim() || !itemsText.trim()}
            >
              {t('common.add')}
            </button>
            {dayTaskCount > 0 && (
              <button
                type="button"
                className="btn btn-plain btn-small"
                onClick={createFromDay}
                disabled={busy || !name.trim()}
              >
                {t('templates.copyDayN', { day: dayName, count: dayTaskCount })}
              </button>
            )}
          </div>
        </form>

        <div className="dt-scroll">
          {templates.length === 0 ? (
            <p className="muted">{t('templates.none')}</p>
          ) : (
            <ul className="dt-list">
              {templates.map((tpl) => (
                <li key={tpl.id} className="dt-item">
                  <div className="dt-item-main">
                    {editingId === tpl.id ? (
                      <input
                        type="text"
                        className="dt-rename-input"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => void saveName(tpl)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void saveName(tpl);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setEditingId(null);
                          }
                        }}
                        disabled={busy}
                        autoFocus
                        maxLength={60}
                      />
                    ) : (
                      <button
                        type="button"
                        className="dt-item-name"
                        onClick={() => {
                          setEditingId(tpl.id);
                          setEditingName(tpl.name);
                        }}
                        title={
                          tpl.items.map((i) => (i.plannedStart ? `${i.plannedStart} ${i.name}` : i.name)).join('\n') ||
                          t('templates.noItems')
                        }
                      >
                        {tpl.name}
                      </button>
                    )}
                    <span className="dt-item-count">
                      {tpl.items.length} {plural(tpl.items.length, t('templates.taskCountOne'), t('templates.taskCountMany'))}
                    </span>
                  </div>
                  <div className="dt-item-actions">
                    <button
                      type="button"
                      className="btn btn-tinted btn-small"
                      onClick={() => apply(tpl)}
                      disabled={busy || tpl.items.length === 0}
                    >
                      {t('templates.applyTo', { day: dayName })}
                    </button>
                    <button
                      type="button"
                      className="dt-item-delete"
                      onClick={() => setPendingDelete(tpl)}
                      disabled={busy}
                      aria-label={t('templates.deleteAria', { name: tpl.name })}
                      title={t('templates.deleteTitle')}
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {error && <p className="error">{error}</p>}
        </div>

        <div className="sheet-actions">
          <button type="button" className="btn btn-plain" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={t('templates.deleteTitle')}
          message={t('templates.deleteBody')}
          confirmLabel={t('common.delete')}
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
