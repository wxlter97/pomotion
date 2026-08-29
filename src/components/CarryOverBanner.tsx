export default function CarryOverBanner({
  count,
  auto,
  onToggleAuto,
  onCarryOver,
  busy,
}: {
  count: number;
  auto: boolean;
  onToggleAuto: () => void;
  onCarryOver: () => void;
  busy: boolean;
}) {
  return (
    <div className="info banner carry-over-banner">
      <span>
        {count === 1
          ? 'Tenés 1 tarea pendiente de un día pasado.'
          : `Tenés ${count} tareas pendientes de días pasados.`}
      </span>
      <div className="carry-over-actions">
        <button
          type="button"
          className="btn btn-tinted btn-small"
          onClick={onCarryOver}
          disabled={busy}
        >
          {busy ? 'Moviendo…' : 'Traer a hoy'}
        </button>
        <label className="carry-over-auto">
          <input type="checkbox" checked={auto} onChange={onToggleAuto} />
          automático
        </label>
      </div>
    </div>
  );
}
