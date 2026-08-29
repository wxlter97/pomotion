import { useCallback, useEffect, useRef, useState } from 'react';
import { getFocusHeatmap, UnauthorizedError } from '../api';
import { formatDurationLabel } from '../duration';
import {
  focusDateLabel,
  heatmapColumns,
  HEATMAP_ROW_LABELS,
  intensityLevel,
  monthLabels,
} from '../focusHeatmap';
import type { FocusHeatmap as FocusHeatmapData } from '../types';

const RANGES = [
  { weeks: 26, label: '6 meses' },
  { weeks: 52, label: '1 año' },
] as const;

export default function FocusHeatmap({
  fileId,
  onClose,
}: {
  fileId: string | null;
  onClose: () => void;
}) {
  const [weeks, setWeeks] = useState(26);
  const [data, setData] = useState<FocusHeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
        setData(await getFocusHeatmap(w, fileId ?? undefined));
      } catch (err) {
        setError(
          err instanceof UnauthorizedError
            ? 'La sesión expiró. Recargá la página para volver a entrar.'
            : err instanceof Error
              ? err.message
              : 'No se pudo cargar el heatmap'
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

  // Abrir mostrando lo más reciente (hoy queda a la vista sin scrollear).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [data]);

  const columns = data ? heatmapColumns(data.startDate, data.endDate) : [];
  const byDate = new Map(data?.days.map((d) => [d.date, d.totalSeconds]) ?? []);
  const months = monthLabels(columns);
  const colStyle = { gridTemplateColumns: `repeat(${columns.length}, var(--hm-size))` };

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--heatmap"
        role="dialog"
        aria-modal="true"
        aria-labelledby="heatmap-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="heatmap-title">Heatmap de foco</h2>

        <div className="heatmap-controls">
          <div className="segmented">
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
          {data && (
            <p className="heatmap-summary">
              <strong>{formatDurationLabel(data.totalSeconds)}</strong> en {data.activeDays}{' '}
              {data.activeDays === 1 ? 'día con foco' : 'días con foco'}
            </p>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        {data && (
          <div className="heatmap-scroll" ref={scrollRef}>
            <div className="heatmap-grid" aria-busy={loading}>
              <div className="heatmap-months" style={colStyle}>
                {months.map((m) => (
                  <span key={m.index} style={{ gridColumnStart: m.index + 1 }}>
                    {m.label}
                  </span>
                ))}
              </div>
              <div className="heatmap-rows">
                {HEATMAP_ROW_LABELS.map((l, i) => (
                  <span key={i}>{l}</span>
                ))}
              </div>
              <div className="heatmap-cols">
                {columns.map((col, ci) => (
                  <div className="heatmap-col" key={ci}>
                    {col.map((date, ri) => {
                      if (!date) {
                        return <div className="heatmap-cell heatmap-cell--empty" key={ri} />;
                      }
                      const secs = byDate.get(date) ?? 0;
                      return (
                        <div
                          key={ri}
                          className={`heatmap-cell l${intensityLevel(secs)}${
                            date === data.today ? ' is-today' : ''
                          }`}
                          title={`${focusDateLabel(date)}: ${
                            secs > 0 ? formatDurationLabel(secs) : 'sin foco'
                          }`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="heatmap-legend">
          <span>menos</span>
          <span className="heatmap-cell l0" />
          <span className="heatmap-cell l1" />
          <span className="heatmap-cell l2" />
          <span className="heatmap-cell l3" />
          <span className="heatmap-cell l4" />
          <span>más</span>
        </div>

        <div className="sheet-actions">
          <button type="button" className="btn btn-plain" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
