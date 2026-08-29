import { useEffect, useMemo, useState } from 'react';
import { getReport, reportCsvUrl, UnauthorizedError, type ReportRow } from '../api';
import { formatDurationLabel } from '../duration';

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
const todayLocal = () => ymdLocal(new Date());
const firstOfMonthLocal = () => {
  const d = new Date();
  return ymdLocal(new Date(d.getFullYear(), d.getMonth(), 1));
};

function aggregate(rows: ReportRow[], key: (r: ReportRow) => string): [string, number][] {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(key(r), (totals.get(key(r)) ?? 0) + r.durationSeconds);
  return [...totals].sort((a, b) => b[1] - a[1]);
}

export default function Report({ fileId, onClose }: { fileId: string | null; onClose: () => void }) {
  const [from, setFrom] = useState(firstOfMonthLocal);
  const [to, setTo] = useState(todayLocal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    rows: ReportRow[];
    totalSeconds: number;
    estimatedMinutes: number;
  } | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const rangeValid = from <= to;

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      setResult(await getReport(from, to, fileId ?? undefined));
    } catch (err) {
      setResult(null);
      setError(
        err instanceof UnauthorizedError
          ? 'La sesión expiró. Recargá la página para volver a entrar.'
          : err instanceof Error
            ? err.message
            : 'No se pudo generar el reporte'
      );
    } finally {
      setLoading(false);
    }
  }

  const byTask = useMemo(() => (result ? aggregate(result.rows, (r) => r.task) : []), [result]);
  const byDay = useMemo(() => (result ? aggregate(result.rows, (r) => r.date) : []), [result]);

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--report"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="report-title">Reporte de tiempo</h2>

        <div className="report-range">
          <label>
            Desde
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>

        {!rangeValid && <p className="error">El "desde" no puede ser posterior al "hasta".</p>}

        <div className="report-buttons">
          <button
            type="button"
            className="btn btn-filled"
            onClick={() => void generate()}
            disabled={loading || !rangeValid}
          >
            {loading ? 'Generando…' : 'Generar'}
          </button>
          {rangeValid && (
            <a
              className="btn btn-plain"
              href={reportCsvUrl(from, to, fileId ?? undefined)}
              download={`pomotion-${from}_${to}.csv`}
            >
              Descargar CSV
            </a>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        {result && (
          <div className="report-result">
            <p className="report-total">
              Total <strong>{formatDurationLabel(result.totalSeconds)}</strong> · {result.rows.length}{' '}
              {result.rows.length === 1 ? 'sesión' : 'sesiones'}
              {result.estimatedMinutes > 0 && (
                <>
                  {' · '}Estimado{' '}
                  <strong
                    className={
                      result.totalSeconds > result.estimatedMinutes * 60 ? 'report-over' : undefined
                    }
                  >
                    {formatDurationLabel(result.estimatedMinutes * 60)}
                  </strong>
                </>
              )}
            </p>

            {result.rows.length === 0 ? (
              <p className="muted">No hay sesiones registradas en ese rango.</p>
            ) : (
              <>
                <h3>Por tarea</h3>
                <table className="report-table">
                  <tbody>
                    {byTask.map(([task, secs]) => (
                      <tr key={task}>
                        <td>{task}</td>
                        <td>{formatDurationLabel(secs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <h3>Por día</h3>
                <table className="report-table">
                  <tbody>
                    {byDay.map(([date, secs]) => (
                      <tr key={date}>
                        <td>{date}</td>
                        <td>{formatDurationLabel(secs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
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
