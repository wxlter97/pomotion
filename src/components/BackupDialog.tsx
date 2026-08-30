import { useEffect, useRef, useState } from 'react';
import { backupDownloadUrl, importBackup, UnauthorizedError } from '../api';

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
        setError('Ese archivo no parece un backup de pomotion.');
        setStage({ kind: 'idle' });
        return;
      }
      setStage({ kind: 'ready', fileName: file.name, backup, rows: countRows(backup) });
    } catch {
      setError('No se pudo leer el archivo (¿es un .json válido?).');
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
          ? 'La sesión expiró. Recargá la página para volver a entrar.'
          : err instanceof Error
            ? err.message
            : 'No se pudo restaurar el backup'
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
        <h2 id="backup-title">Copia de seguridad</h2>

        {error && <p className="error">{error}</p>}

        {stage.kind === 'done' ? (
          <>
            <p className="muted">
              Backup restaurado:{' '}
              {Object.entries(stage.imported)
                .filter(([, n]) => n > 0)
                .map(([t, n]) => `${n} ${t}`)
                .join(' · ') || 'sin datos'}
              .
            </p>
            <div className="sheet-actions">
              <button
                type="button"
                className="btn btn-filled"
                onClick={() => window.location.reload()}
              >
                Recargar
              </button>
            </div>
          </>
        ) : (
          <>
            <section className="backup-section">
              <h3>Exportar</h3>
              <p className="muted">
                Descargá todo tu dataset (tareas, sesiones, etiquetas, plantillas, metas,
                calendarios) en un archivo <code>.json</code>. Guardalo en un lugar seguro.
              </p>
              <a className="btn btn-plain" href={backupDownloadUrl} download>
                Descargar copia (.json)
              </a>
            </section>

            <section className="backup-section">
              <h3>Restaurar</h3>
              <p className="muted">
                Solo funciona en una <strong>cuenta vacía</strong> — sirve para pasar tus
                datos a otro dispositivo o cuenta, no para fusionar.
              </p>

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
                  {stage.rows} {stage.rows === 1 ? 'fila' : 'filas'} a restaurar.
                </p>
              )}

              <div className="sheet-actions">
                <button type="button" className="btn btn-plain" onClick={onClose} disabled={busy}>
                  Cerrar
                </button>
                <button
                  type="button"
                  className="btn btn-filled"
                  onClick={() => void runImport()}
                  disabled={stage.kind !== 'ready' || busy}
                >
                  {busy ? 'Restaurando…' : 'Restaurar'}
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
