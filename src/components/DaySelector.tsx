export default function DaySelector({
  week,
  days,
  selectedDay,
  onSelectDay,
  isCurrentWeek,
  hasPreviousWeek,
  hasNextWeek,
  onPreviousWeek,
  onNextWeek,
  onGoToCurrentWeek,
  onAddWeek,
}: {
  week: string;
  days: string[];
  selectedDay: string | null;
  onSelectDay: (day: string) => void;
  isCurrentWeek: boolean;
  hasPreviousWeek: boolean;
  hasNextWeek: boolean;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onGoToCurrentWeek: () => void;
  onAddWeek: () => void;
}) {
  return (
    <div className="day-selector">
      <div className="week-nav">
        <button
          type="button"
          className="btn btn-icon"
          onClick={onPreviousWeek}
          disabled={!hasPreviousWeek}
          aria-label="Semana anterior"
          title="Semana anterior ([)"
        >
          ‹
        </button>
        <span className="week-label">{week}</span>
        <button
          type="button"
          className="btn btn-icon"
          onClick={onNextWeek}
          disabled={!hasNextWeek}
          aria-label="Semana siguiente"
          title="Semana siguiente (])"
        >
          ›
        </button>
        {!isCurrentWeek && (
          <button type="button" className="btn btn-tinted week-today-btn" onClick={onGoToCurrentWeek}>
            Hoy
          </button>
        )}
        <button
          type="button"
          className="btn btn-icon week-add-btn"
          onClick={onAddWeek}
          aria-label="Agregar semana"
          title="Agregar la semana siguiente"
        >
          +
        </button>
      </div>
      <div className="day-tabs">
        {days.map((day) => (
          <button
            key={day}
            className={day === selectedDay ? 'day-tab active' : 'day-tab'}
            onClick={() => onSelectDay(day)}
            type="button"
          >
            {day}
          </button>
        ))}
      </div>
    </div>
  );
}
