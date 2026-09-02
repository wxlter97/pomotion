import { useT } from '../i18n';
import Footer from './Footer';

/** Pantalla de arranque: se muestra mientras se resuelve el estado de login
 * (¿hay sesión?, ¿está aprobada?) antes de decidir qué pantalla mostrar. */
export default function Splash() {
  const t = useT();

  return (
    <div className="center-screen splash-screen">
      <div className="screen-content">
        <div className="splash-card">
          <img className="splash-logo" src="/favicon.svg" alt="" width={64} height={64} />
          <h1>pomotion</h1>
          <div className="spinner spinner-large" aria-hidden="true" />
          <p className="muted">{t('common.loading')}</p>
        </div>
      </div>
      <Footer />
    </div>
  );
}
