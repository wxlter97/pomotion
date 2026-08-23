import { useCallback, useEffect, useRef, useState } from 'react';
import { getTasks, logout, reorderTask, UnauthorizedError, updateTaskChecked } from './api';
import ConfirmDialog from './components/ConfirmDialog';
import DaySelector from './components/DaySelector';
import Login from './components/Login';
import TaskList from './components/TaskList';
import Timer, { type TimerHandle } from './components/Timer';
import { computeAfterBlockId } from './taskReorder';
import { loadActiveTimer } from './timerStorage';
import type { Session, Task, TasksResponse, TimerPhase } from './types';
import { useTheme } from './useTheme';

type AuthState = 'checking' | 'authed' | 'guest' | 'error';
type PendingSwitch = { message: string; run: () => void };

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
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [busyTaskIds, setBusyTaskIds] = useState<Set<string>>(new Set());
  const [theme, toggleTheme] = useTheme();
  const timerRef = useRef<TimerHandle>(null);

  // Mientras haya un timer corriendo, la tarea activa queda con sus
  // controles de mover/arrastrar/borrar bloqueados — reordenarla o
  // borrarla le cambiaría (o le quitaría) el blockId por debajo, y
  // Timer.tsx detecta "cambié de tarea" comparando blockId, lo que
  // descartaría la sesión en curso sin guardarla. El resto de tareas del
  // día siguen totalmente editables.
  const lockedTaskBlockId = timerPhase !== 'idle' ? (selectedTask?.blockId ?? null) : null;

  const refresh = useCallback(async (day?: string, week?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getTasks(day, week);
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

  const guardIfRunning = useCallback(
    (message: string, run: () => void) => {
      if (timerPhase !== 'idle') {
        setPendingSwitch({ message, run });
      } else {
        run();
      }
    },
    [timerPhase]
  );

  const guardedSelectTask = useCallback(
    (task: Task) => {
      if (task.blockId === selectedTask?.blockId) return;
      guardIfRunning('Cambiar de tarea lo cancela sin guardar esa sesión.', () => setSelectedTask(task));
    },
    [selectedTask, guardIfRunning]
  );

  const guardedSelectDay = useCallback(
    (day: string) => {
      if (day === data?.selectedDay) return;
      // Mantener la misma semana que se está viendo (no volver a "hoy" al
      // cambiar de día dentro de una semana pasada/futura).
      guardIfRunning('Cambiar de día lo cancela sin guardar esa sesión.', () => void refresh(day, data?.week));
    },
    [data, refresh, guardIfRunning]
  );

  // weekLabel === undefined => volver a la semana actual (auto-detección).
  const guardedGoToWeek = useCallback(
    (weekLabel: string | undefined) => {
      guardIfRunning('Cambiar de semana lo cancela sin guardar esa sesión.', () => void refresh(undefined, weekLabel));
    },
    [refresh, guardIfRunning]
  );

  function confirmPendingSwitch() {
    pendingSwitch?.run();
    setPendingSwitch(null);
  }

  // Atajos de teclado: espacio inicia/detiene, 1–5 cambia de día,
  // [ / ] cambia de semana, T cambia el tema.
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
      } else if (e.key === '[' && data?.previousWeekLabel) {
        guardedGoToWeek(data.previousWeekLabel);
      } else if (e.key === ']' && data?.nextWeekLabel) {
        guardedGoToWeek(data.nextWeekLabel);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [timerPhase, data, pendingSwitch, authState, toggleTheme, guardedSelectDay, guardedGoToWeek]);

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

  function setTaskChecked(blockId: string, checked: boolean) {
    setData((prev) => {
      if (!prev) return prev;
      return { ...prev, tasks: prev.tasks.map((t) => (t.blockId === blockId ? { ...t, checked } : t)) };
    });
  }

  async function handleToggleChecked(task: Task) {
    const nextChecked = !task.checked;
    setTogglingIds((prev) => new Set(prev).add(task.blockId));
    setTaskChecked(task.blockId, nextChecked); // optimista
    try {
      await updateTaskChecked(task.blockId, nextChecked);
    } catch (err) {
      setTaskChecked(task.blockId, task.checked); // revertir
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la tarea en Notion');
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(task.blockId);
        return next;
      });
    }
  }

  function handleTaskCreated(task: { blockId: string; text: string; checked: boolean }) {
    setData((prev) => {
      if (!prev) return prev;
      return { ...prev, tasks: [...prev.tasks, { ...task, day: prev.selectedDay ?? '', sessions: [] }] };
    });
  }

  function handleTaskDeleted(blockId: string) {
    setData((prev) => (prev ? { ...prev, tasks: prev.tasks.filter((t) => t.blockId !== blockId) } : prev));
    setSelectedTask((prev) => (prev?.blockId === blockId ? null : prev));
  }

  async function handleReorderTask(task: Task, targetIndex: number) {
    if (!data?.dayContainerId || !data.dayHeadingBlockId) return;
    const afterBlockId = computeAfterBlockId(data.tasks, task.blockId, targetIndex, data.dayHeadingBlockId);
    const originalTasks = data.tasks;
    const originalIndex = originalTasks.findIndex((t) => t.blockId === task.blockId);
    if (originalIndex === -1) return;

    // Reorden visual optimista (solo posiciones, sin tocar ids) para que
    // se sienta instantáneo; se confirma con refresh() al terminar.
    const reordered = [...originalTasks];
    reordered.splice(originalIndex, 1);
    reordered.splice(Math.max(0, Math.min(targetIndex, reordered.length)), 0, task);
    setData((prev) => (prev ? { ...prev, tasks: reordered } : prev));
    setBusyTaskIds((prev) => new Set(prev).add(task.blockId));

    try {
      await reorderTask(task.blockId, data.dayContainerId, afterBlockId);
      void refresh(data.selectedDay ?? undefined, data.week);
    } catch (err) {
      setData((prev) => (prev ? { ...prev, tasks: originalTasks } : prev)); // revertir
      setError(err instanceof Error ? err.message : 'No se pudo reordenar la tarea');
    } finally {
      setBusyTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(task.blockId);
        return next;
      });
    }
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
          <button
            type="button"
            className="btn btn-plain"
            onClick={() => void refresh(data?.selectedDay ?? undefined, data?.week)}
            disabled={loading}
          >
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
          <button type="button" className="btn btn-plain" onClick={() => void handleLogout()}>
            Salir
          </button>
        </div>
      </header>

      {error && <p className="error banner">{error}</p>}
      {data && data.weekSource === 'auto-fallback' && (
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
              onSelectDay={guardedSelectDay}
              isCurrentWeek={data.isCurrentWeek}
              hasPreviousWeek={Boolean(data.previousWeekLabel)}
              hasNextWeek={Boolean(data.nextWeekLabel)}
              onPreviousWeek={() => data.previousWeekLabel && guardedGoToWeek(data.previousWeekLabel)}
              onNextWeek={() => data.nextWeekLabel && guardedGoToWeek(data.nextWeekLabel)}
              onGoToCurrentWeek={() => guardedGoToWeek(undefined)}
            />
            {totalMinutesToday > 0 && (
              <div className="total-pill" title="Total registrado este día">
                <span className="total-pill-label">Total</span>
                <span className="total-pill-value">{formatTotal(totalMinutesToday)}</span>
              </div>
            )}
          </div>

          {data.availableDays.length === 0 ? (
            <div className="empty-week card">
              <p className="muted">
                Esta semana no tiene tareas desglosadas por día en Notion (ej. una semana de
                vacaciones o feriados). Usa las flechas de arriba para ver otra semana.
              </p>
            </div>
          ) : (
            <div className="main-grid">
              <section className="tasks-panel card">
                <TaskList
                  tasks={data.tasks}
                  selectedBlockId={selectedTask?.blockId ?? null}
                  onSelect={guardedSelectTask}
                  onToggleChecked={(task) => void handleToggleChecked(task)}
                  togglingIds={togglingIds}
                  onSessionDeleted={handleSessionDeleted}
                  dayContainerId={data.dayContainerId}
                  dayHeadingBlockId={data.dayHeadingBlockId}
                  lockedTaskBlockId={lockedTaskBlockId}
                  busyTaskIds={busyTaskIds}
                  onTaskCreated={handleTaskCreated}
                  onTaskDeleted={handleTaskDeleted}
                  onReorderTask={(task, targetIndex) => void handleReorderTask(task, targetIndex)}
                />
              </section>

              <section className="timer-panel card">
                <Timer
                  ref={timerRef}
                  task={selectedTask}
                  onSessionLogged={handleSessionLogged}
                  onPhaseChange={setTimerPhase}
                />
              </section>
            </div>
          )}

          <footer className="shortcuts-hint">
            <kbd>espacio</kbd> inicia/detiene · <kbd>1</kbd>–<kbd>5</kbd> cambia de día ·{' '}
            <kbd>[</kbd>/<kbd>]</kbd> cambia de semana · <kbd>T</kbd> cambia el tema
          </footer>
        </>
      )}

      {pendingSwitch && (
        <ConfirmDialog
          title="¿Cancelar el timer en curso?"
          message={`Tienes un timer corriendo. ${pendingSwitch.message}`}
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
