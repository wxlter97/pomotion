import { useEffect } from 'react';
import { useT } from '../i18n';
import type { InstallPrompt } from '../useInstallPrompt';

/**
 * Diálogo "Acerca de": nombre, versión (de package.json vía __APP_VERSION__,
 * ver vite.config.ts) y una forma de instalar la PWA si el navegador lo
 * permite — mismo prompt que el banner y el ítem de Ajustes.
 */
export default function AboutDialog({
  installPrompt,
  onClose,
}: {
  installPrompt: InstallPrompt;
  onClose: () => void;
}) {
  const t = useT();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--about"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="about-title">{t('about.title')}</h2>
        <p className="about-version">{t('about.version', { version: __APP_VERSION__ })}</p>
        <p className="muted">{t('app.tagline')}</p>

        {installPrompt.installed ? (
          <p className="about-installed">✓ {t('about.installed')}</p>
        ) : (
          installPrompt.available && (
            <button
              type="button"
              className="btn btn-tinted"
              onClick={() => void installPrompt.requestInstall()}
            >
              {t('about.install')}
            </button>
          )
        )}

        <div className="sheet-actions">
          <button type="button" className="btn btn-filled" onClick={onClose}>
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  );
}
