import { useEffect, useState } from 'react';
import { useT } from '../i18n';

const DEFAULT_DURATION_MS = 8000;
const FADE_MS = 300;

/**
 * Aviso que se desvanece solo después de un rato — para advertencias
 * informativas que no necesitan quedarse pegadas en pantalla para siempre.
 * Dar un `key` distinto en el llamador (ej. por el valor que cambia) hace
 * que reaparezca cuando el aviso es genuinamente uno nuevo, en vez de
 * reiniciarse en cada re-render por algo no relacionado.
 */
export default function DismissibleBanner({
  message,
  tone = 'warning',
  durationMs = DEFAULT_DURATION_MS,
}: {
  message: string;
  tone?: 'warning' | 'error' | 'success';
  durationMs?: number;
}) {
  const t = useT();
  const [state, setState] = useState<'visible' | 'fading' | 'hidden'>('visible');

  useEffect(() => {
    const id = setTimeout(() => setState('fading'), durationMs);
    return () => clearTimeout(id);
  }, [durationMs]);

  useEffect(() => {
    if (state !== 'fading') return;
    const id = setTimeout(() => setState('hidden'), FADE_MS);
    return () => clearTimeout(id);
  }, [state]);

  if (state === 'hidden') return null;

  return (
    <div className={`${tone} banner dismissible-banner${state === 'fading' ? ' fading' : ''}`}>
      <span>{message}</span>
      <button
        type="button"
        className="banner-dismiss"
        onClick={() => setState('fading')}
        aria-label={t('common.dismissNotice')}
        title={t('common.close')}
      >
        ×
      </button>
    </div>
  );
}
