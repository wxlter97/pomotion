import { useEffect, useState } from 'react';

/**
 * `true` si el navegador cree que hay conexión. `navigator.onLine` no es
 * infalible (puede decir que sí sin internet real), pero alcanza para
 * mostrar el aviso de "estás viendo lo último guardado".
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
