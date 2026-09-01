import { useCallback, useEffect, useRef, useState } from 'react';
import { getMonthSummary, UnauthorizedError } from '../api';
import { isWeekend, monthGrid, monthTitle, weekTargetForDate } from '../monthGrid';
import { useLang, useT } from '../i18n';
import type { MonthDaySummary, MonthSummary } from '../types';

/** Compacta segundos para la celda del día: "45m" / "1h" / "1h30". */
function shortDuration(seconds: number): string {
  if (seconds < 60) return '';
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h${m}`;
}

export default function MonthView({
  fileId,
  initialMonth,
  onPick,
  onClose,
}: {
  fileId: string | null;
  /** Mes a abrir ("YYYY-MM"); por defecto, el mes en curso del server. */
  initialMonth?: string;
  /** Navegar la vista semanal a (semana, día) y cerrar. */
  onPick: (week: string, day: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const [month, setMonth] = useState<string | undefined>(initialMonth);
  const [data, setData] = useState<MonthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // El mes visible, para recargar sin perderlo si cambia el archivo.
  const monthRef = useRef<string | undefined>(initialMonth);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const load = useCallback(
    async (m: string | undefined) => {
      setLoading(true);
      setError(null);
      try {
        const res = await getMonthSummary(m, fileId ?? undefined);
        setData(res);
        setMonth(res.month);
        monthRef.current = res.month;
      } catch (err) {
        setError(
          err instanceof UnauthorizedError
            ? t('common.sessionExpired')
            : err instanceof Error
              ? err.message
              : t('month.error')
        );
      } finally {
        setLoading(false);
      }
    },
    [fileId]
  );

  // Carga inicial y recarga si cambia el archivo (conservando el mes visible).
  useEffect(() => {
    void load(monthRef.current);
  }, [load]);

  const byDate = new Map<string, MonthDaySummary>(data?.days.map((d) => [d.date, d]) ?? []);
  const weeks = month ? monthGrid(month) : [];

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--month"
        role="dialog"
        aria-modal="true"
        aria-labelledby="month-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="month-header">
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => void load(data?.previousMonth)}
            disabled={loading}
            aria-label={t('month.prev')}
          >
            ‹
          </button>
          <h2 id="month-title">{month ? monthTitle(month, lang) : '—'}</h2>
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => void load(data?.nextMonth)}
            disabled={loading}
            aria-label={t('month.next')}
          >
            ›
          </button>
          {data && !data.isCurrentMonth && (
            <button
              type="button"
              className="btn btn-tinted btn-small"
              onClick={() => void load(undefined)}
              disabled={loading}
            >
              {t('month.today')}
            </button>
          )}
        </div>

        <div className="month-scroll">
          {error && <p className="error">{error}</p>}

          <div className="month-grid" aria-busy={loading}>
            <div className="month-weekdays">
              {t('month.weekdayHeaders').split(',').map((h, i) => (
                <span key={i}>{h}</span>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div className="month-week" key={wi}>
                {week.map((date, di) => {
                  if (!date) return <div className="month-cell month-cell--pad" key={di} />;
                  const s = byDate.get(date);
                  const weekend = isWeekend(date);
                  const dayNum = Number(date.slice(8, 10));
                  const isToday = data?.today === date;
                  const body = (
                    <>
                      <span className={`month-cell-num${isToday ? ' is-today' : ''}`}>{dayNum}</span>
                      {s && (
                        <span className="month-cell-meta">
                          {s.taskCount > 0 && (
                            <span className={s.doneCount === s.taskCount ? 'all-done' : undefined}>
                              {s.doneCount}/{s.taskCount}
                            </span>
                          )}
                          {s.totalSeconds > 0 && (
                            <span className="month-cell-hrs">{shortDuration(s.totalSeconds)}</span>
                          )}
                        </span>
                      )}
                    </>
                  );
                  if (weekend) {
                    return (
                      <div className="month-cell month-cell--weekend" key={di}>
                        {body}
                      </div>
                    );
                  }
                  const target = weekTargetForDate(date);
                  return (
                    <button
                      type="button"
                      className="month-cell month-cell--day"
                      key={di}
                      onClick={() => onPick(target.week, target.day)}
                      title={t('month.goTo', { date })}
                    >
                      {body}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="sheet-actions">
          <button type="button" className="btn btn-plain" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
