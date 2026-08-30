import { useEffect, useMemo, useState } from 'react';
import { getReport, reportCsvUrl, UnauthorizedError, type ReportRow } from '../api';
import { formatDurationLabel } from '../duration';
import type { Tag } from '../types';
import { plural, useT } from '../i18n';

const NO_TAG = '__none__';

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
  const t = useT();
  const [from, setFrom] = useState(firstOfMonthLocal);
  const [to, setTo] = useState(todayLocal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    rows: ReportRow[];
    totalSeconds: number;
    estimatedMinutes: number;
    tags: Tag[];
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
          ? t('common.sessionExpired')
          : err instanceof Error
            ? err.message
            : t('report.error')
      );
    } finally {
      setLoading(false);
    }
  }

  const byTask = useMemo(() => (result ? aggregate(result.rows, (r) => r.task) : []), [result]);
  const byDay = useMemo(() => (result ? aggregate(result.rows, (r) => r.date) : []), [result]);
  const byTag = useMemo(() => {
    if (!result) return [];
    const totals = new Map<string, number>();
    for (const r of result.rows) {
      const keys = r.tagIds.length > 0 ? r.tagIds : [NO_TAG];
      for (const k of keys) totals.set(k, (totals.get(k) ?? 0) + r.durationSeconds);
    }
    return [...totals].sort((a, b) => b[1] - a[1]);
  }, [result]);
  const tagName = useMemo(
    () => new Map((result?.tags ?? []).map((tag) => [tag.id, tag.name] as const)),
    [result]
  );
  const hasTaggedRows = byTag.some(([k]) => k !== NO_TAG);

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--report"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="report-title">{t('report.title')}</h2>

        <div className="report-range">
          <label>
            {t('report.from')}
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            {t('report.to')}
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>

        {!rangeValid && <p className="error">{t('report.badRange')}</p>}

        <div className="report-buttons">
          <button
            type="button"
            className="btn btn-filled"
            onClick={() => void generate()}
            disabled={loading || !rangeValid}
          >
            {loading ? t('report.generating') : t('report.generate')}
          </button>
          {rangeValid && (
            <a
              className="btn btn-plain"
              href={reportCsvUrl(from, to, fileId ?? undefined)}
              download={`pomotion-${from}_${to}.csv`}
            >
              {t('report.downloadCsv')}
            </a>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        {result && (
          <div className="report-result">
            <p className="report-total">
              {t('report.total')} <strong>{formatDurationLabel(result.totalSeconds)}</strong> · {result.rows.length}{' '}
              {plural(result.rows.length, t('report.sessionOne'), t('report.sessionMany'))}
              {result.estimatedMinutes > 0 && (
                <>
                  {' · '}{t('report.estimated')}{' '}
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
              <p className="muted">{t('report.empty')}</p>
            ) : (
              <>
                <h3>{t('report.byTask')}</h3>
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

                <h3>{t('report.byDay')}</h3>
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

                {hasTaggedRows && (
                  <>
                    <h3>{t('report.byTag')}</h3>
                    <p className="report-note">
                      {t('report.byTagNote')}
                    </p>
                    <table className="report-table">
                      <tbody>
                        {byTag.map(([key, secs]) => (
                          <tr key={key}>
                            <td>{key === NO_TAG ? t('common.noTag') : (tagName.get(key) ?? t('report.deletedTag'))}</td>
                            <td>{formatDurationLabel(secs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            )}
          </div>
        )}

        <div className="sheet-actions">
          <button type="button" className="btn btn-plain" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
