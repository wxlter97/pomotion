import { useCallback, useEffect, useState } from 'react';

/** El evento no estandarizado que Chrome/Edge disparan cuando la PWA es
 *  instalable. Safari/Firefox no lo soportan — ahí `available` queda en
 *  `false` y no se muestra nada (instalar sigue siendo posible a mano
 *  desde el menú del navegador). */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/** `true` si la app ya corre "instalada" (standalone) — Chrome/Android vía
 *  `display-mode`, iOS Safari vía `navigator.standalone`. */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  return Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

export type InstallPrompt = {
  /** Hay un prompt de instalación listo para mostrar y la app no está instalada. */
  available: boolean;
  /** La app ya corre instalada (standalone). */
  installed: boolean;
  /** Dispara el prompt nativo del navegador. 'unavailable' si no había ninguno guardado. */
  requestInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
};

/** Captura el evento `beforeinstallprompt` (Chrome/Edge/Android) para poder
 *  ofrecer un botón propio de "Instalar" en vez de esperar a que el usuario
 *  encuentre la opción del navegador. Ver también `appinstalled`. */
export function useInstallPrompt(): InstallPrompt {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      setInstalled(true);
      setDeferred(null);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const requestInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferred) return 'unavailable';
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // Un prompt nativo solo se puede usar una vez.
    setDeferred(null);
    return outcome;
  }, [deferred]);

  return { available: deferred !== null && !installed, installed, requestInstall };
}
