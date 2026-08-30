import { useEffect, useRef, useState } from 'react';
import { backupDownloadUrl, importBackup, UnauthorizedError } from '../api';
import { plural, useT } from '../i18n';

type Stage =
  | { kind: 'idle' }
  | { kind: 'ready'; fileName: string; backup: unknown; rows: number }
  | { kind: 'importing' }
  | { kind: 'done'; imported: Record<string, number> };

/** Suma de filas de un `data` de backup, para el resumen previo. */
function countRows(backup: unknown): number {
  const data = (backup as { data?: Record<string, unknown[]> } | null)?.data;
  if (!data || typeof data !== 'object') return 0;
  return Object.values(data).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
}

export default function BackupDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && stage.kind !== 'importing') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, stage.kind]);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reelegir el mismo archivo
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const backup = JSON.parse(text) as unknown;
      const fmt = (backup as { format?: unknown } | null)?.format;
      if (fmt !== 'pomotion-backup') {
        setError(t('backup.notBackup'));
        setStage({ kind: 'idle' });
        return;
      }
      setStage({ kind: 'ready', fileName: file.name, backup, rows: countRows(backup) });
    } catch {
      setError(t('backup.badJson'));
      setStage({ kind: 'idle' });
    }
  }

  async function runImport() {
    if (stage.kind !== 'ready') return;
    const { backup } = stage;
    setStage({ kind: 'importing' });
    setError(null);
    try {
      const res = await importBackup(backup);
      setStage({ kind: 'done', imported: res.imported });
    } catch (err) {
      setStage({ kind: 'ready', fileName: '', backup, rows: countRows(backup) });
      setError(
        err instanceof UnauthorizedError
          ? t('common.sessionExpired')
          : err instanceof Error
            ? err.message
            : t('backup.restoreError')
      );
    }
  }

  const busy = stage.kind === 'importing';

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose} role="presentation">
      <div
        className="sheet sheet--backup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="backup-title">{t('backup.title')}</h2>

        {error && <p className="error">{error}</p>}

        {stage.kind === 'done' ? (
          <>
            <p className="muted">
              {t('backup.restored', {
                summary:
                  Object.entries(stage.imported)
                    .filter(([, n]) => n > 0)
                    .map(([table, n]) => `${n} ${table}`)
                    .join(' · ') || t('backup.noData'),
              })}
            </p>
            <div className="sheet-actions">
              <button
                type="button"
                className="btn btn-filled"
                onClick={() => window.location.reload()}
              >
                {t('backup.reload')}
              </button>
            </div>
          </>
        ) : (
          <>
            <section className="backup-section">
              <h3>{t('backup.export')}</h3>
              <p className="muted">{t('backup.exportDesc')}</p>
              <a className="btn btn-plain" href={backupDownloadUrl} download>
                {t('backup.downloadBtn')}
              </a>
            </section>

            <section className="backup-section">
              <h3>{t('backup.restore')}</h3>
              <p className="muted">{t('backup.restoreDesc')}</p>

              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="backup-file"
                onChange={(e) => void onFileChange(e)}
                disabled={busy}
              />

              {stage.kind === 'ready' && (
                <p className="backup-ready">
                  {stage.fileName ? `${stage.fileName} — ` : ''}
                  {t('backup.toRestore', { n: stage.rows, word: plural(stage.rows, t('backup.rowOne'), t('backup.rowMany')) })}
                </p>
              )}

              <div className="sheet-actions">
                <button type="button" className="btn btn-plain" onClick={onClose} disabled={busy}>
                  {t('common.close')}
                </button>
                <button
                  type="button"
                  className="btn btn-filled"
                  onClick={() => void runImport()}
                  disabled={stage.kind !== 'ready' || busy}
                >
                  {busy ? t('backup.restoring') : t('backup.restore')}
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
