import { useCallback, useEffect, useState } from 'react';
import { getAnalytics, UnauthorizedError } from '../api';
import { formatDurationLabel } from '../duration';
import type { Analytics as AnalyticsData, EstimateAccuracy } from '../types';

/** Bloque "Precisión de estimación": el mensaje + dos barras estimado/registrado. */
function EstimateAccuracyBlock({ a }: { a: EstimateAccuracy }) {
  const max = Math.max(a.totalEstimatedSeconds, a.totalLoggedSeconds, 1);
  const message =
    a.biasPct >= 5
      ? `En promedio tardás un ${a.biasPct}% más de lo que estimás.`
      : a.biasPct <= -5
        ? `En promedio terminás un ${Math.abs(a.biasPct)}% antes de lo que estimás.`
        : 'Tus estimaciones vienen bastante justas.';

  return (
    <div className="an-estimate">
      <p className="an-estimate-msg">{message}</p>
      <div className="an-weekday">
        <div className="an-weekday-row">
          <span className="an-weekday-name">Estimado</span>
          <div className="an-weekday-track">
            <div
              className="an-weekday-fill"
              style={{ width: `${Math.round((a.totalEstimatedSeconds / max) * 100)}%` }}
            />
          </div>
          <span className="an-weekday-value">{formatDurationLabel(a.totalEstimatedSeconds)}</span>
        </div>
        <div className="an-weekday-row">
          <span className="an-weekday-name">Registrado</span>
          <div className="an-weekday-track">
            <div
              className={a.biasPct >= 5 ? 'an-weekday-fill is-over' : 'an-weekday-fill'}
              style={{ width: `${Math.round((a.totalLoggedSeconds / max) * 100)}%` }}
            />
          </div>
          <span className="an-weekday-value">{formatDurationLabel(a.totalLoggedSeconds)}</span>
        </div>
      </div>
      <p className="an-estimate-hint">
        {Math.abs(a.biasPct) >= 5 && (
          <>Multiplicá tus estimaciones por ~{a.suggestedFactor}. · </>
        )}
        {a.count} {a.count === 1 ? 'tarea completada' : 'tareas completadas'}
      </p>
    </div>
  );
}

const RANGES = [
  { weeks: 4, label: '4 sem' },
  { weeks: 12, label: '12 sem' },
  { weeks: 26, label: '26 sem' },
] as const;

function pct(value: number, max: number): number {
  return max > 0 ? Math.round((value / max) * 100) : 0;
}

/** Etiqueta breve para las barras: "7.2h" / "45m". */
function compactHours(seconds: number): string {
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)}h`;
  return `${Math.round(seconds / 60)}m`;
}

/** Fila de barras verticales (semanas, horas). */
function BarStrip({
  items,
  label,
}: {
  items: { key: string; label: string; showLabel: boolean; value: number }[];
  label: (v: number) => string;
}) {
  const max = Math.max(0, ...items.map((i) => i.value));
  return (
    <div className="an-strip">
      {items.map((it) => (
        <div className="an-strip-col" key={it.key} title={`${it.label}: ${label(it.value)}`}>
          <div className="an-strip-track">
            <div
              className={it.value > 0 ? 'an-strip-fill' : 'an-strip-fill is-empty'}
              style={{ height: `${it.value > 0 ? Math.max(4, pct(it.value, max)) : 0}%` }}
            />
          </div>
          <span className={it.showLabel ? 'an-strip-label' : 'an-strip-label is-hidden'}>
            {it.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Analytics({
  fileId,
  onClose,
}: {
  fileId: string | null;
  onClose: () => void;
}) {
  const [weeks, setWeeks] = useState(12);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const load = useCallback(
    async (w: number) => {
      setLoading(true);
      setError(null);
      try {
        setData(await getAnalytics(w, fileId ?? undefined));
      } catch (err) {
        setError(
          err instanceof UnauthorizedError
            ? 'La sesión expiró. Recargá la página para volver a entrar.'
            : err instanceof Error
              ? err.message
              : 'No se pudo cargar la analítica'
        );
      } finally {
        setLoading(false);
      }
    },
    [fileId]
  );

  useEffect(() => {
    void load(weeks);
  }, [load, weeks]);

  const weekdayMax = data ? Math.max(0, ...data.byWeekday.map((d) => d.totalSeconds)) : 0;
  const rate = data && data.completion.total > 0
    ? Math.round((data.completion.done / data.completion.total) * 100)
    : 0;

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--analytics"
        role="dialog"
        aria-modal="true"
        aria-labelledby="analytics-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="analytics-title">Analítica</h2>

        <div className="segmented an-range">
          {RANGES.map((r) => (
            <button
              key={r.weeks}
              type="button"
              className={r.weeks === weeks ? 'is-active' : undefined}
              onClick={() => setWeeks(r.weeks)}
              disabled={loading}
            >
              {r.label}
            </button>
          ))}
        </div>

        {error && <p className="error">{error}</p>}

        {data && data.totalSeconds === 0 && !error && (
          <p className="muted">Sin tiempo registrado en este período.</p>
        )}

        {data && data.totalSeconds > 0 && (
          <div className="an-body" aria-busy={loading}>
            <div className="an-stats">
              <div className="an-stat">
                <span className="an-stat-value">{formatDurationLabel(data.totalSeconds)}</span>
                <span className="an-stat-label">registrado</span>
              </div>
              <div className="an-stat">
                <span className="an-stat-value">{data.activeDays}</span>
                <span className="an-stat-label">
                  {data.activeDays === 1 ? 'día activo' : 'días activos'}
                </span>
              </div>
              <div className="an-stat">
                <span className="an-stat-value">{data.streak.current}</span>
                <span className="an-stat-label">racha actual</span>
              </div>
              <div className="an-stat">
                <span className="an-stat-value">{data.streak.longest}</span>
                <span className="an-stat-label">mejor racha</span>
              </div>
            </div>

            <section className="an-section">
              <h3>Tasa de completado</h3>
              <div className="an-completion">
                <div className="an-completion-track">
                  <div className="an-completion-fill" style={{ width: `${rate}%` }} />
                </div>
                <span className="an-completion-text">
                  {rate}% · {data.completion.done}/{data.completion.total} tareas
                </span>
              </div>
            </section>

            {data.estimateAccuracy && (
              <section className="an-section">
                <h3>Precisión de estimación</h3>
                <EstimateAccuracyBlock a={data.estimateAccuracy} />
              </section>
            )}

            <section className="an-section">
              <h3>Por día de la semana</h3>
              <div className="an-weekday">
                {data.byWeekday.map((d) => (
                  <div className="an-weekday-row" key={d.label}>
                    <span className="an-weekday-name">{d.label}</span>
                    <div className="an-weekday-track">
                      <div
                        className="an-weekday-fill"
                        style={{ width: `${pct(d.totalSeconds, weekdayMax)}%` }}
                      />
                    </div>
                    <span className="an-weekday-value">
                      {d.totalSeconds > 0 ? compactHours(d.totalSeconds) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="an-section">
              <h3>Por hora del día</h3>
              <BarStrip
                label={formatDurationLabel}
                items={data.byHour.map((h) => ({
                  key: String(h.hour),
                  label: `${String(h.hour).padStart(2, '0')}h`,
                  showLabel: h.hour % 6 === 0,
                  value: h.totalSeconds,
                }))}
              />
            </section>

            <section className="an-section">
              <h3>Tendencia semanal</h3>
              <BarStrip
                label={formatDurationLabel}
                items={data.byWeek.map((w, i) => ({
                  key: w.weekStart,
                  label: w.label,
                  showLabel: data.byWeek.length <= 8 || i % 4 === 0,
                  value: w.totalSeconds,
                }))}
              />
            </section>
          </div>
        )}

        <div className="sheet-actions">
          <button type="button" className="btn btn-plain" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
