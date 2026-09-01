import { useState } from 'react';
import type { MsgKey } from '../i18n';
import { useT } from '../i18n';
import Analytics from './Analytics';
import Report from './Report';
import FocusHeatmap from './FocusHeatmap';
import WeeklyReviewDialog from './WeeklyReviewDialog';

type StatsSection = 'summary' | 'reports' | 'heatmap' | 'review';

const SECTIONS: { key: StatsSection; labelKey: MsgKey }[] = [
  { key: 'summary', labelKey: 'stats.summary' },
  { key: 'reports', labelKey: 'stats.reports' },
  { key: 'heatmap', labelKey: 'stats.heatmap' },
  { key: 'review', labelKey: 'stats.review' },
];

/**
 * Pestaña "Stats": un segmented control interno reemplaza lo que antes
 * eran cuatro diálogos separados (Analítica / Reporte / Heatmap / Revisión
 * semanal), reusándolos tal cual en modo `embedded`.
 */
export default function StatsTab({
  fileId,
  week,
  onChanged,
  onOpenGoals,
}: {
  fileId: string | null;
  week: string;
  onChanged: () => void;
  onOpenGoals: () => void;
}) {
  const t = useT();
  const [section, setSection] = useState<StatsSection>('summary');

  return (
    <div className="stats-tab">
      <div className="stats-tab-header">
        <h2>{t('nav.stats')}</h2>
        <button type="button" className="btn btn-tinted" onClick={onOpenGoals}>
          {t('menu.goals')}
        </button>
      </div>

      <div className="stats-tabs segmented-control" role="tablist" aria-label={t('nav.stats')}>
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={section === s.key}
            className={section === s.key ? 'segment active' : 'segment'}
            onClick={() => setSection(s.key)}
          >
            {t(s.labelKey)}
          </button>
        ))}
      </div>

      {section === 'summary' && <Analytics fileId={fileId} onClose={() => {}} embedded />}
      {section === 'reports' && <Report fileId={fileId} onClose={() => {}} embedded />}
      {section === 'heatmap' && <FocusHeatmap fileId={fileId} onClose={() => {}} embedded />}
      {section === 'review' && (
        <WeeklyReviewDialog initialWeek={week} onClose={() => {}} onChanged={onChanged} embedded />
      )}
    </div>
  );
}
