import { localizeDay, plural, useLang, useT } from '../i18n';
import type { DayColumn, Tag } from '../types';
import Menu, { MenuItem } from './Menu';
import { movableTargets } from './TaskRowMenu';

/**
 * Barra de acciones en lote — aparece arriba de la lista cuando hay ≥1 tarea
 * seleccionada. Completar / mover a otro día / etiquetar / sacar de la agenda
 * / borrar, todo de una.
 */
export default function BulkActionBar({
  count,
  days,
  currentDay,
  tags,
  busy,
  onComplete,
  onMove,
  onAddTag,
  onInbox,
  onDelete,
  onCancel,
}: {
  count: number;
  days: DayColumn[];
  currentDay: string;
  tags: Tag[];
  busy: boolean;
  onComplete: () => void;
  onMove: (date: string) => void;
  onAddTag: (tagId: string) => void;
  onInbox: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const moveTargets = movableTargets(days, currentDay);

  return (
    <div className="bulk-bar" role="region" aria-label={t('bulk.title')}>
      <div className="bulk-bar-top">
        <span className="bulk-count">
          {count} {plural(count, t('bulk.selectedOne'), t('bulk.selectedMany'))}
        </span>
        <button
          type="button"
          className="bulk-cancel"
          onClick={onCancel}
          disabled={busy}
          aria-label={t('bulk.cancel')}
          title={t('bulk.cancelTitle')}
        >
          ✕
        </button>
      </div>

      <div className="bulk-actions">
        <button type="button" className="btn btn-plain btn-small" onClick={onComplete} disabled={busy}>
          {t('bulk.complete')}
        </button>

        {moveTargets.length > 0 && (
          <Menu
            ariaLabel={t('bulk.moveTitle')}
            triggerClassName="btn btn-plain btn-small"
            trigger={t('bulk.move')}
          >
            {(close) => (
              <>
                {moveTargets.map((d) => (
                  <MenuItem
                    key={d.date}
                    onClick={() => {
                      onMove(d.date);
                      close();
                    }}
                  >
                    {localizeDay(d.day, lang)}
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>
        )}

        {tags.length > 0 && (
          <Menu
            ariaLabel={t('bulk.tagTitle')}
            triggerClassName="btn btn-plain btn-small"
            trigger={t('bulk.tag')}
          >
            {(close) => (
              <>
                {tags.map((tag) => (
                  <MenuItem
                    key={tag.id}
                    onClick={() => {
                      onAddTag(tag.id);
                      close();
                    }}
                  >
                    {tag.name}
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>
        )}

        <button type="button" className="btn btn-plain btn-small" onClick={onInbox} disabled={busy}>
          {t('inbox.title')}
        </button>
        <button type="button" className="btn btn-destructive btn-small" onClick={onDelete} disabled={busy}>
          {t('common.delete')}
        </button>
      </div>
    </div>
  );
}
