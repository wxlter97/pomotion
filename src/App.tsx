import { useCallback, useEffect, useRef, useState } from 'react';
import { getTasks, logout, UnauthorizedError } from './api';
import ConfirmDialog from './components/ConfirmDialog';
import DaySelector from './components/DaySelector';
import Login from './components/Login';
import TaskList from './components/TaskList';
import Timer, { type TimerHandle } from './components/Timer';
import { loadActiveTimer } from './timerStorage';
import type { Session, Task, TasksResponse, TimerPhase } from './types';
import { useTheme } from './useTheme';

type AuthState = 'checking' | 'authed' | 'guest' | 'error';
type PendingSwitch = { type: 'task'; task: Task } | { type: 'day'; day: string };

function formatTotal(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [data, setData] = useState<TasksResponse | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timerPhase, setTimerPhase] = useState<TimerPhase>('idle');
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const [theme, toggleTheme] = useTheme();
  const timerRef = useRef<TimerHandle>(null);

  const refresh = useCallback(async (day?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getTasks(day);
      setData(res);
      setAuthState('authed');
      setSelectedTask((prev) => {
        const matchByPrev = res.tasks.find((t) => t.blockId === prev?.blockId);
        if (matchByPrev) return matchByPrev;
        // Sin selección previa (primera carga / cambio de día): si hay un
        // timer restaurable de localStorage para una tarea de este día,
        // seleccionarla para que el timer pueda retomarlo.
        const persisted = loadActiveTimer();
        if (persisted) {
          const match = res.tasks.find((t) => t.blockId === persisted.taskBlockId);
          if (match) return match;
        }
        return null;
      });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setAuthState('guest');
        setData(null);
        setSelectedTask(null);
      } else {
        setError(err instanceof Error ? err.message : 'Error cargando tareas');
        setAuthState((prev) => (prev === 'checking' ? 'error' : prev));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const guardedSelectTask = useCallback(
    (task: Task) => {
      if (timerPhase !== 'idle' && task.blockId !== selectedTask?.blockId) {
        setPendingSwitch({ type: 'task', task });
      } else {
        setSelectedTask(task);
      }
    },
    [timerPhase, selectedTask]
  );

  const guardedSelectDay = useCallback(
    (day: string) => {
      if (timerPhase !== 'idle' && day !== data?.selectedDay) {
        setPendingSwitch({ type: 'day', day });
      } else {
        void refresh(day);
      }
    },
    [timerPhase, data, refresh]
  );

  function confirmPendingSwitch() {
    if (!pendingSwitch) return;
    if (pendingSwitch.type === 'task') setSelectedTask(pendingSwitch.task);
    else void refresh(pendingSwitch.day);
    setPendingSwitch(null);
  }

  // Atajos de teclado: espacio inicia/detiene, 1–5 cambia de día, T cambia el tema.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isTyping || pendingSwitch || authState !== 'authed') return;

      if (e.key === ' ') {
        e.preventDefault();
        if (timerPhase === 'idle') timerRef.current?.start();
        else timerRef.current?.stop();
      } else if (e.key === 't' || e.key === 'T') {
        toggleTheme();
      } else if (/^[1-5]$/.test(e.key) && data) {
        const day = data.availableDays[Number(e.key) - 1];
        if (day) guardedSelectDay(day);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [timerPhase, data, pendingSwitch, authState, toggleTheme, guardedSelectDay]);

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

  function handleSessionDeleted(taskBlockId: string, sessionBlockId: string) {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.blockId === taskBlockId
            ? { ...t, sessions: t.sessions.filter((s) => s.blockId !== sessionBlockId) }
            : t
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

  const themeToggleButton = (
    <button
      type="button"
      className="btn btn-icon"
      onClick={toggleTheme}
      title="Cambiar tema (T)"
      aria-label="Cambiar tema"
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );

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
          <button type="button" className="btn btn-filled" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Reintentando…' : 'Reintentar'}
          </button>
        </div>
      </div>
    );
  }

  const totalMinutesToday = data
    ? data.tasks.reduce((sum, t) => sum + t.sessions.reduce((s, ses) => s + ses.durationMinutes, 0), 0)
    : 0;

  return (
    <div className="app">
      <header className="app-header">
        <h1>pomotion</h1>
        <div className="header-actions">
          {themeToggleButton}
          <button type="button" className="btn btn-plain" onClick={() => void refresh(data?.selectedDay)} disabled={loading}>
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
          <button type="button" className="btn btn-plain" onClick={() => void handleLogout()}>
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
          <div className="day-row">
            <DaySelector
              week={data.week}
              days={data.availableDays}
              selectedDay={data.selectedDay}
              onSelect={guardedSelectDay}
            />
            {totalMinutesToday > 0 && (
              <div className="total-pill" title="Total registrado este día">
                <span className="total-pill-label">Total</span>
                <span className="total-pill-value">{formatTotal(totalMinutesToday)}</span>
              </div>
            )}
          </div>

          <div className="main-grid">
            <section className="tasks-panel card">
              <TaskList
                tasks={data.tasks}
                selectedBlockId={selectedTask?.blockId ?? null}
                onSelect={guardedSelectTask}
                onSessionDeleted={handleSessionDeleted}
              />
            </section>

            <section className="timer-panel card">
              <Timer ref={timerRef} task={selectedTask} onSessionLogged={handleSessionLogged} onPhaseChange={setTimerPhase} />
            </section>
          </div>

          <footer className="shortcuts-hint">
            <kbd>espacio</kbd> inicia/detiene · <kbd>1</kbd>–<kbd>5</kbd> cambia de día ·{' '}
            <kbd>T</kbd> cambia el tema
          </footer>
        </>
      )}

      {pendingSwitch && (
        <ConfirmDialog
          title="¿Cancelar el timer en curso?"
          message={
            pendingSwitch.type === 'task'
              ? `Tienes un timer corriendo. Cambiar de tarea lo cancela sin guardar esa sesión.`
              : `Tienes un timer corriendo. Cambiar de día lo cancela sin guardar esa sesión.`
          }
          confirmLabel="Cancelar timer y cambiar"
          cancelLabel="Seguir con el timer"
          destructive
          onConfirm={confirmPendingSwitch}
          onCancel={() => setPendingSwitch(null)}
        />
      )}
    </div>
  );
}
