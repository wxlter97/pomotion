import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { login } from '../api';

export default function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function performLogin() {
    if (loading || password.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      await login(password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void performLogin();
  }

  // No depender solo del submit implícito del navegador al presionar Enter
  // (poco fiable entre navegadores/teclados/autocompletado) — se maneja
  // explícito acá, y se cancela el default para no disparar el submit del
  // form dos veces.
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void performLogin();
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>pomotion</h1>
        <p className="muted">Ingresa la contraseña para continuar</p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Contraseña"
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn btn-filled btn-large" disabled={loading || password.length === 0}>
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
