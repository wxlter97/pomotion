import { useEffect, useRef } from 'react';

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
          aria-label="Semana anterior"
          title="Semana anterior ([)"
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
          aria-label="Semana siguiente"
          title="Semana siguiente (])"
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
            Hoy
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
          >
            {day}
          </button>
        ))}
      </div>
    </div>
  );
}
