import { useCallback, useEffect, useRef, useState } from 'react';
import { getFocusHeatmap, UnauthorizedError } from '../api';
import { formatDurationLabel } from '../duration';
import { focusDateLabel, heatmapColumns, intensityLevel, monthLabels } from '../focusHeatmap';
import { plural, useLang, useT } from '../i18n';
import type { FocusHeatmap as FocusHeatmapData } from '../types';

const RANGES = [
  { weeks: 26, labelKey: 'heatmap.range6m' as const },
  { weeks: 52, labelKey: 'heatmap.range1y' as const },
] as const;

export default function FocusHeatmap({
  fileId,
  onClose,
  embedded = false,
}: {
  fileId: string | null;
  onClose: () => void;
  /** Se usa embebida dentro de la pestaña "Stats" (sin backdrop ni botón
   *  Cerrar) en vez de como diálogo flotante. */
  embedded?: boolean;
}) {
  const t = useT();
  const { lang } = useLang();
  const [weeks, setWeeks] = useState(26);
  const [data, setData] = useState<FocusHeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (embedded) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, embedded]);

  const load = useCallback(
    async (w: number) => {
      setLoading(true);
      setError(null);
      try {
        setData(await getFocusHeatmap(w, fileId ?? undefined));
      } catch (err) {
        setError(
          err instanceof UnauthorizedError
            ? t('common.sessionExpired')
            : err instanceof Error
              ? err.message
              : t('heatmap.error')
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
  const months = monthLabels(columns, lang);
  const colStyle = { gridTemplateColumns: `repeat(${columns.length}, var(--hm-size))` };

  return (
    <div
      className={embedded ? 'heatmap-embedded' : 'sheet-backdrop'}
      onClick={embedded ? undefined : onClose}
      role={embedded ? undefined : 'presentation'}
    >
      <div
        className={embedded ? 'heatmap-inner' : 'sheet sheet--heatmap'}
        role={embedded ? undefined : 'dialog'}
        aria-modal={embedded ? undefined : true}
        aria-labelledby={embedded ? undefined : 'heatmap-title'}
        onClick={embedded ? undefined : (e) => e.stopPropagation()}
      >
        {!embedded && <h2 id="heatmap-title">{t('heatmap.title')}</h2>}

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
                {t(r.labelKey)}
              </button>
            ))}
          </div>
          {data && (
            <p className="heatmap-summary">
              <strong>{formatDurationLabel(data.totalSeconds)}</strong>
              {t('heatmap.inDays')}
              {data.activeDays} {plural(data.activeDays, t('heatmap.dayOne'), t('heatmap.dayMany'))}
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
                {t('heatmap.rowLabels').split(',').map((l: string, i: number) => (
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
                          title={`${focusDateLabel(date, lang)}: ${
                            secs > 0 ? formatDurationLabel(secs) : t('heatmap.noFocus')
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
          <span>{t('heatmap.less')}</span>
          <span className="heatmap-cell l0" />
          <span className="heatmap-cell l1" />
          <span className="heatmap-cell l2" />
          <span className="heatmap-cell l3" />
          <span className="heatmap-cell l4" />
          <span>{t('heatmap.more')}</span>
        </div>

        {!embedded && (
          <div className="sheet-actions">
            <button type="button" className="btn btn-plain" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
