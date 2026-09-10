import { useEffect } from 'react';
import {
  addBlock,
  copyToWeekdays,
  removeBlock,
  setDayEnabled,
  setFeatureEnabled,
  updateBlock,
  WEEKDAYS,
  type BusinessHoursSettings,
  type Weekday,
} from '../businessHours';
import { useT } from '../i18n';

const WEEKDAY_ONLY: Weekday[] = ['1', '2', '3', '4', '5'];

/**
 * Ajuste de "horas hábiles": franjas horarias disponibles por día de la
 * semana, con varios bloques por día para modelar pausas (ej. almuerzo) y
 * jornadas distintas entre días (ej. viernes solo hasta el mediodía).
 * Se usa para sugerir la hora de inicio al agregar una sesión manual sin
 * horario planeado (ver defaultManualStart en TaskList.tsx).
 */
export default function BusinessHoursDialog({
  settings,
  onChange,
  onClose,
}: {
  settings: BusinessHoursSettings;
  onChange: (next: BusinessHoursSettings) => void;
  onClose: () => void;
}) {
  const t = useT();
  const dayLabels = t('analytics.weekdayAbbrs').split(',');

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--business-hours"
        role="dialog"
        aria-modal="true"
        aria-labelledby="business-hours-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="business-hours-title">{t('businessHours.title')}</h2>
        <p className="muted">{t('businessHours.intro')}</p>

        <label className="timer-toggle bh-master-toggle">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => onChange(setFeatureEnabled(settings, e.target.checked))}
          />
          <span>{t('businessHours.enable')}</span>
        </label>

        <div className="bh-scroll">
          <ul className="bh-days">
            {WEEKDAYS.map((weekday, i) => {
              const day = settings.days[weekday];
              const disabled = !settings.enabled || !day.enabled;
              return (
                <li key={weekday} className="bh-day">
                  <div className="bh-day-header">
                    <label className="bh-day-name">
                      <input
                        type="checkbox"
                        checked={day.enabled}
                        disabled={!settings.enabled}
                        onChange={(e) => onChange(setDayEnabled(settings, weekday, e.target.checked))}
                      />
                      <span>{dayLabels[i]}</span>
                    </label>
                    {WEEKDAY_ONLY.includes(weekday) && (
                      <button
                        type="button"
                        className="btn btn-plain btn-small"
                        disabled={!settings.enabled || !day.enabled}
                        onClick={() => onChange(copyToWeekdays(settings, weekday))}
                        title={t('businessHours.copyToWeekdaysTitle')}
                      >
                        {t('businessHours.copyToWeekdays')}
                      </button>
                    )}
                  </div>

                  <div className="bh-blocks">
                    {day.blocks.length === 0 && (
                      <p className="muted bh-no-blocks">{t('businessHours.noBlocks')}</p>
                    )}
                    {day.blocks.map((block, bi) => (
                      <div key={bi} className="bh-block">
                        <input
                          type="time"
                          className="task-planned-start-input"
                          value={block.start}
                          disabled={disabled}
                          onChange={(e) => onChange(updateBlock(settings, weekday, bi, { start: e.target.value }))}
                        />
                        <span>–</span>
                        <input
                          type="time"
                          className="task-planned-start-input"
                          value={block.end}
                          disabled={disabled}
                          onChange={(e) => onChange(updateBlock(settings, weekday, bi, { end: e.target.value }))}
                        />
                        <button
                          type="button"
                          className="session-delete"
                          disabled={!settings.enabled || !day.enabled}
                          onClick={() => onChange(removeBlock(settings, weekday, bi))}
                          aria-label={t('businessHours.removeBlock')}
                          title={t('businessHours.removeBlock')}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="btn btn-plain btn-small"
                    disabled={!settings.enabled || !day.enabled}
                    onClick={() => onChange(addBlock(settings, weekday))}
                  >
                    {t('businessHours.addBlock')}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="sheet-actions">
          <button type="button" className="btn btn-filled" onClick={onClose}>
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  );
}
