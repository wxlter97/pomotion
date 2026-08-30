/**
 * Registro del service worker (ver public/sw.js) + aviso de "hay versión
 * nueva". En dev no se registra: rompe el HMR de Vite y no aporta nada.
 */

/**
 * Registra el SW y llama a `onUpdateReady` cuando quedó un worker nuevo
 * esperando (o sea: hay una versión más reciente lista para aplicar).
 */
export function registerServiceWorker(onUpdateReady: () => void): void {
  if (import.meta.env.DEV) return;
  if (!('serviceWorker' in navigator)) return;

  // Esperar a `load` para no competir con la carga inicial — pero si la
  // página ya cargó (React monta después de `load`), registrar de una.
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });

  function start() {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Pestaña abierta después de un deploy: ya hay uno esperando.
        if (reg.waiting && navigator.serviceWorker.controller) onUpdateReady();

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              onUpdateReady();
            }
          });
        });
      })
      .catch(() => {
        // Sin SW no pasa nada — la app funciona igual, solo sin offline.
      });

    // Cuando el worker nuevo toma el control (tras SKIP_WAITING), recargamos
    // una vez para levantar los assets nuevos.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  }
}

/** Aplica la actualización pendiente: le dice al worker que espera que tome
 *  el control. El `controllerchange` de arriba se encarga de recargar. */
export function applyUpdate(): void {
  void navigator.serviceWorker?.getRegistration().then((reg) => {
    reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  });
}
