import { useEffect, useRef } from 'react';
import { localizeDay, useLang, useT } from '../i18n';

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export default function DaySelector({
  week,
  days,
  selectedDay,
  onSelectDay,
  isCurrentWeek,
  onPreviousWeek,
  onNextWeek,
  onGoToCurrentWeek,
  loading,
}: {
  week: string;
  days: string[];
  selectedDay: string;
  onSelectDay: (day: string) => void;
  isCurrentWeek: boolean;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onGoToCurrentWeek: () => void;
  loading?: boolean;
}) {
  const t = useT();
  const { lang } = useLang();
  const tabsRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  // Al cambiar de día seleccionado (incluye la carga inicial), centrarlo en
  // el scroll horizontal si el contenedor no cabe en una sola línea.
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedDay]);

  return (
    <div className="day-selector">
      <div className="week-nav">
        <button
          type="button"
          className="btn btn-icon"
          onClick={onPreviousWeek}
          disabled={loading}
          aria-label={t('day.prevWeek')}
          title={t('day.prevWeekTitle')}
        >
          ‹
        </button>
        <span className="week-label">
          {week}
          {loading && <Spinner />}
        </span>
        <button
          type="button"
          className="btn btn-icon"
          onClick={onNextWeek}
          disabled={loading}
          aria-label={t('day.nextWeek')}
          title={t('day.nextWeekTitle')}
        >
          ›
        </button>
        {!isCurrentWeek && (
          <button
            type="button"
            className="btn btn-tinted week-today-btn"
            onClick={onGoToCurrentWeek}
            disabled={loading}
          >
            {t('day.today')}
          </button>
        )}
      </div>
      <div className="day-tabs" ref={tabsRef}>
        {days.map((day) => (
          <button
            key={day}
            ref={day === selectedDay ? activeTabRef : undefined}
            className={day === selectedDay ? 'day-tab active' : 'day-tab'}
            onClick={() => onSelectDay(day)}
            disabled={loading}
            type="button"
            data-drag-zone={`day:${day}`}
          >
            {localizeDay(day, lang)}
          </button>
        ))}
      </div>
    </div>
  );
}
