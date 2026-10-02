import { useEffect, useRef, useState } from 'react';
import { ADS_FREE_PRICE_LABEL } from '../constants';
import { useT } from '../i18n';

/** Los anuncios solo se muestran en desktop; en el celular ni se montan. */
const DESKTOP_QUERY = '(min-width: 721px)';

/** Credenciales de AdSense (build time). Sin ellas el bloque muestra un
 *  recuadro vacío con el tamaño reservado y NO carga ningún script. */
const ADSENSE_CLIENT = import.meta.env.VITE_ADSENSE_CLIENT as string | undefined;
const ADSENSE_SLOT = import.meta.env.VITE_ADSENSE_SLOT as string | undefined;

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return desktop;
}

let adsenseScriptRequested = false;

/** Inyecta el script de AdSense una sola vez por carga de página. */
function loadAdsenseScript(client: string) {
  if (adsenseScriptRequested) return;
  adsenseScriptRequested = true;
  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  document.head.appendChild(script);
}

function AdsenseUnit({ client, slot }: { client: string; slot: string }) {
  const pushed = useRef(false);
  useEffect(() => {
    loadAdsenseScript(client);
    // `push` una sola vez por unidad: repetirlo lanza "already have ads".
    if (pushed.current) return;
    pushed.current = true;
    try {
      (window.adsbygoogle = window.adsbygoogle ?? []).push({});
    } catch {
      // un bloqueador de anuncios puede romperlo: el recuadro queda vacío
    }
  }, [client]);
  return (
    <ins
      className="adsbygoogle ad-slot-unit"
      style={{ display: 'block' }}
      data-ad-client={client}
      data-ad-slot={slot}
      data-ad-format="rectangle"
      data-full-width-responsive="false"
    />
  );
}

/**
 * Bloque de publicidad bajo el timer. Con `VITE_ADSENSE_CLIENT` +
 * `VITE_ADSENSE_SLOT` muestra una unidad de Google AdSense; sin ellas, un
 * recuadro con el tamaño reservado (para que al activar los anuncios no
 * salte el layout). El caller no lo monta si el usuario ya pagó.
 */
export default function AdSlot({ onRemoveAds, removing }: { onRemoveAds: () => void; removing: boolean }) {
  const t = useT();
  const desktop = useIsDesktop();
  if (!desktop) return null;

  return (
    <aside className="ad-slot card" aria-label={t('ads.label')}>
      <div className="ad-slot-head">
        <span className="ad-slot-label">{t('ads.label')}</span>
        <button type="button" className="ad-slot-remove" onClick={onRemoveAds} disabled={removing}>
          {removing ? t('ads.starting') : t('ads.remove', { price: ADS_FREE_PRICE_LABEL })}
        </button>
      </div>
      <div className="ad-slot-body">
        {ADSENSE_CLIENT && ADSENSE_SLOT ? (
          <AdsenseUnit client={ADSENSE_CLIENT} slot={ADSENSE_SLOT} />
        ) : (
          <div className="ad-slot-placeholder" aria-hidden="true" />
        )}
      </div>
    </aside>
  );
}
