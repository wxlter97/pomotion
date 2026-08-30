import { useT } from '../i18n';

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
  const t = useT();
  return (
    <div className="info banner carry-over-banner">
      <span>{count === 1 ? t('carryOver.one') : t('carryOver.many', { count })}</span>
      <div className="carry-over-actions">
        <button
          type="button"
          className="btn btn-tinted btn-small"
          onClick={onCarryOver}
          disabled={busy}
        >
          {busy ? t('carryOver.moving') : t('carryOver.bring')}
        </button>
        <label className="carry-over-auto">
          <input type="checkbox" checked={auto} onChange={onToggleAuto} />
          {t('carryOver.auto')}
        </label>
      </div>
    </div>
  );
}
