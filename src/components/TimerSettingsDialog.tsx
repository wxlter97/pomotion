import { useEffect, useState } from 'react';
import { DEFAULT_TIMER_SETTINGS, TIMER_LIMITS, type TimerSettings } from '../timerSettings';

type NumField = 'workMinutes' | 'shortBreakMinutes' | 'longBreakMinutes' | 'longBreakEvery';

const FIELDS: { key: NumField; label: string; hint?: string }[] = [
  { key: 'workMinutes', label: 'Foco', hint: 'min' },
  { key: 'shortBreakMinutes', label: 'Descanso corto', hint: 'min' },
  { key: 'longBreakMinutes', label: 'Descanso largo', hint: 'min' },
  { key: 'longBreakEvery', label: 'Descanso largo cada', hint: 'pomos' },
];

export default function TimerSettingsDialog({
  settings,
  onUpdate,
  onReset,
  disabled,
  onClose,
}: {
  settings: TimerSettings;
  onUpdate: (patch: Partial<TimerSettings>) => void;
  onReset: () => void;
  /** El timer está corriendo → los campos de duración se bloquean. */
  disabled: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Record<NumField, string>>({
    workMinutes: String(settings.workMinutes),
    shortBreakMinutes: String(settings.shortBreakMinutes),
    longBreakMinutes: String(settings.longBreakMinutes),
    longBreakEvery: String(settings.longBreakEvery),
  });

  // Resincronizar cuando cambian desde afuera (botón "Restaurar").
  useEffect(() => {
    setDraft({
      workMinutes: String(settings.workMinutes),
      shortBreakMinutes: String(settings.shortBreakMinutes),
      longBreakMinutes: String(settings.longBreakMinutes),
      longBreakEvery: String(settings.longBreakEvery),
    });
  }, [settings]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function commit(key: NumField) {
    const n = Number(draft[key]);
    if (Number.isFinite(n) && n !== settings[key]) onUpdate({ [key]: n });
    else setDraft((d) => ({ ...d, [key]: String(settings[key]) })); // revierte texto inválido
  }

  const isDefault =
    settings.workMinutes === DEFAULT_TIMER_SETTINGS.workMinutes &&
    settings.shortBreakMinutes === DEFAULT_TIMER_SETTINGS.shortBreakMinutes &&
    settings.longBreakMinutes === DEFAULT_TIMER_SETTINGS.longBreakMinutes &&
    settings.longBreakEvery === DEFAULT_TIMER_SETTINGS.longBreakEvery &&
    settings.autoStartNext === DEFAULT_TIMER_SETTINGS.autoStartNext;

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--timer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="timer-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="timer-settings-title">Pomodoro</h2>

        {disabled && (
          <p className="muted">Detené el timer para cambiar las duraciones.</p>
        )}

        <div className="timer-fields">
          {FIELDS.map((f) => (
            <label key={f.key} className="timer-field">
              <span className="timer-field-label">
                {f.label}
                {f.hint && <span className="timer-field-hint"> ({f.hint})</span>}
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={TIMER_LIMITS[f.key][0]}
                max={TIMER_LIMITS[f.key][1]}
                value={draft[f.key]}
                disabled={disabled}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                onBlur={() => commit(f.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
            </label>
          ))}
        </div>

        <p className="muted timer-note">Poné 0 en «cada» para no tener descanso largo.</p>

        <label className="timer-toggle">
          <input
            type="checkbox"
            checked={settings.autoStartNext}
            onChange={(e) => onUpdate({ autoStartNext: e.target.checked })}
          />
          <span>Arrancar el siguiente pomodoro solo, al terminar el descanso</span>
        </label>

        <div className="sheet-actions">
          <button type="button" className="btn btn-plain" onClick={onReset} disabled={isDefault}>
            Restaurar
          </button>
          <button type="button" className="btn btn-filled" onClick={onClose}>
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
