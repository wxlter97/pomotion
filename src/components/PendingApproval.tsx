import Footer from './Footer';

export default function PendingApproval({
  email,
  onLogout,
}: {
  email: string | null;
  onLogout: () => void;
}) {
  return (
    <div className="login-screen">
      <div className="screen-content">
        <div className="login-card">
          <h1>pomotion</h1>
          <p>Tu cuenta{email ? ` (${email})` : ''} está pendiente de aprobación.</p>
          <p className="muted">
            Pedile a quien administra pomotion que te habilite el acceso. Después volvé a entrar.
          </p>
          <button type="button" className="btn btn-plain" onClick={onLogout}>
            Salir
          </button>
        </div>
      </div>
      <Footer />
    </div>
  );
}
