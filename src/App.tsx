import { useCallback, useEffect, useState } from 'react';
import { getTasks, logout, UnauthorizedError } from './api';
import DaySelector from './components/DaySelector';
import Login from './components/Login';
import TaskList from './components/TaskList';
import Timer from './components/Timer';
import type { Session, Task, TasksResponse } from './types';

type AuthState = 'checking' | 'authed' | 'guest' | 'error';

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [data, setData] = useState<TasksResponse | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (day?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getTasks(day);
      setData(res);
      setAuthState('authed');
      setSelectedTask((prev) => res.tasks.find((t) => t.blockId === prev?.blockId) ?? null);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setAuthState('guest');
        setData(null);
        setSelectedTask(null);
      } else {
        setError(err instanceof Error ? err.message : 'Error cargando tareas');
        // Si el error ocurrió durante la carga inicial (aún no sabemos si hay
        // sesión válida), no dejar al usuario colgado en "Cargando…".
        setAuthState((prev) => (prev === 'checking' ? 'error' : prev));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function handleSessionLogged(blockId: string, session: Session) {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.blockId === blockId ? { ...t, sessions: [...t.sessions, session] } : t
        ),
      };
    });
  }

  async function handleLogout() {
    await logout();
    setAuthState('guest');
    setData(null);
    setSelectedTask(null);
  }

  if (authState === 'checking') {
    return (
      <div className="center-screen">
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  if (authState === 'guest') {
    return <Login onLoggedIn={() => void refresh()} />;
  }

  if (authState === 'error') {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>pomotion</h1>
          <p className="error">{error ?? 'No se pudo conectar con el servidor'}</p>
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Reintentando…' : 'Reintentar'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>pomotion</h1>
        <div className="header-actions">
          <button type="button" onClick={() => void refresh(data?.selectedDay)} disabled={loading}>
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
          <button type="button" onClick={() => void handleLogout()}>
            Salir
          </button>
        </div>
      </header>

      {error && <p className="error banner">{error}</p>}
      {data && !data.weekMatched && (
        <p className="warning banner">
          No pude identificar automáticamente la semana actual por fecha — mostrando "{data.week}".
          Revisa el formato del encabezado en Notion si esto no es correcto.
        </p>
      )}
      {data && !data.dayMatched && (
        <p className="warning banner">
          No encontré el día de hoy en esta semana — mostrando "{data.selectedDay}" por defecto.
        </p>
      )}

      {data && (
        <>
          <DaySelector
            week={data.week}
            days={data.availableDays}
            selectedDay={data.selectedDay}
            onSelect={(day) => void refresh(day)}
          />

          <div className="main-grid">
            <section className="tasks-panel">
              <TaskList
                tasks={data.tasks}
                selectedBlockId={selectedTask?.blockId ?? null}
                onSelect={setSelectedTask}
              />
            </section>

            <section className="timer-panel">
              <Timer task={selectedTask} onSessionLogged={handleSessionLogged} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
