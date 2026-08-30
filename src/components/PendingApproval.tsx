import { useT } from '../i18n';
import Footer from './Footer';

export default function PendingApproval({
  email,
  onLogout,
}: {
  email: string | null;
  onLogout: () => void;
}) {
  const t = useT();
  return (
    <div className="login-screen">
      <div className="screen-content">
        <div className="login-card">
          <h1>pomotion</h1>
          <p>{t('pending.title', { email: email ? ` (${email})` : '' })}</p>
          <p className="muted">{t('pending.body')}</p>
          <button type="button" className="btn btn-plain" onClick={onLogout}>
            {t('menu.logout')}
          </button>
        </div>
      </div>
      <Footer />
    </div>
  );
}
