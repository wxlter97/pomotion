export default function DaySelector({
  week,
  days,
  selectedDay,
  onSelect,
}: {
  week: string;
  days: string[];
  selectedDay: string;
  onSelect: (day: string) => void;
}) {
  return (
    <div className="day-selector">
      <span className="week-label">{week}</span>
      <div className="day-tabs">
        {days.map((day) => (
          <button
            key={day}
            className={day === selectedDay ? 'day-tab active' : 'day-tab'}
            onClick={() => onSelect(day)}
            type="button"
          >
            {day}
          </button>
        ))}
      </div>
    </div>
  );
}
