import { useCallback, useEffect, useRef, useState } from 'react';
import {
  carryOverToToday,
  getAuthStatus,
  getFiles,
  getTasks,
  logout,
  moveTask,
  PendingApprovalError,
  UnauthorizedError,
  updateTaskDone,
} from './api';
import CarryOverBanner from './components/CarryOverBanner';
import ConfirmDialog from './components/ConfirmDialog';
import DaySelector from './components/DaySelector';
import DismissibleBanner from './components/DismissibleBanner';
import FileSelector from './components/FileSelector';
import Footer from './components/Footer';
import Login from './components/Login';
import PendingApproval from './components/PendingApproval';
import RecurringTasksDialog from './components/RecurringTasksDialog';
import Report from './components/Report';
import type { MoveTarget } from './components/MoveTaskMenu';
import TaskList from './components/TaskList';
import Timer, { type TimerHandle } from './components/Timer';
import { formatDurationLabel } from './duration';
import { computeAfterId } from './taskReorder';
import { loadActiveTimer } from './timerStorage';
import type { FileEntry, Session, Task, TasksResponse, TimerPhase } from './types';
import { useCarryOverSetting } from './useCarryOverSetting';
import { useNotificationSetting } from './useNotificationSetting';
import { useSoundSetting } from './useSoundSetting';
import { useTheme } from './useTheme';

type AuthState = 'checking' | 'authed' | 'guest' | 'pending' | 'error';
type PendingSwitch = { message: string; run: () => void };

const FILE_STORAGE_KEY = 'pomotion:file';

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

function SoundOnIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );
}

function SoundOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M16 9l5 6M21 9l-5 6" />
    </svg>
  );
}

function ReportIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

function BellOnIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2.5 6 2.5 6h-17S6 14 6 9Z" />
      <path d="M10 20a2.5 2.5 0 0 0 4 0" />
    </svg>
  );
}

function BellOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 0 1 9.5-4.9M18 12c0 3 1.5 4.2 2.2 4.8M17.7 17.7H3.5S6 14 6 9M10 20a2.5 2.5 0 0 0 4 0" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      className={spinning ? 'icon-spin' : undefined}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 12a8.5 8.5 0 0 1 14.5-6M20.5 12a8.5 8.5 0 0 1-14.5 6" />
      <path d="M18 3v4h-4M6 21v-4h4" />
    </svg>
  );
}

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [data, setData] = useState<TasksResponse | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timerPhase, setTimerPhase] = useState<TimerPhase>('idle');
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [busyTaskIds, setBusyTaskIds] = useState<Set<string>>(new Set());
  const [showReport, setShowReport] = useState(false);
  const [showRecurring, setShowRecurring] = useState(false);
  const [recurringNotice, setRecurringNotice] = useState<{ text: string; n: number } | null>(null);
  const [carryingOver, setCarryingOver] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const [soundsEnabled, toggleSounds] = useSoundSetting();
  const [carryOverAuto, toggleCarryOverAuto] = useCarryOverSetting();
  const notifications = useNotificationSetting();
  const timerRef = useRef<TimerHandle>(null);
  const carryOverDoneRef = useRef(false);

  // Selector de archivo (Trabajo/Casa/…). Vacío si el usuario no tiene
  // tareas con `file` → modo de un solo contexto, el selector no aparece.
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const selectedFileIdRef = useRef<string | null>(null);
  const filesLoadedRef = useRef(false);

  // Mientras haya un timer corriendo, la tarea activa queda con sus
  // controles de mover/borrar bloqueados — Timer.tsx detecta "cambié de
  // tarea" comparando el id, y moverla se lo cambiaría.
  const lockedTaskId = timerPhase !== 'idle' ? (selectedTask?.id ?? null) : null;

  const refresh = useCallback(async (day?: string, week?: string, fileIdParam?: string) => {
    setLoading(true);
    setError(null);
    try {
      let fileId = fileIdParam ?? selectedFileIdRef.current ?? undefined;
      if (!filesLoadedRef.current) {
        const filesRes = await getFiles();
        filesLoadedRef.current = true;
        setFiles(filesRes.files);
        if (filesRes.files.length > 0 && !fileId) {
          const stored = localStorage.getItem(FILE_STORAGE_KEY);
          fileId = filesRes.files.find((f) => f.id === stored)?.id ?? filesRes.files[0].id;
        }
        if (fileId) {
          setSelectedFileId(fileId);
          selectedFileIdRef.current = fileId;
        }
      }
      const res = await getTasks(day, week, fileId);
      setData(res);
      setAuthState('authed');
      setSelectedTask((prev) => {
        const matchByPrev = res.tasks.find((t) => t.id === prev?.id);
        if (matchByPrev) return matchByPrev;
        const persisted = loadActiveTimer();
        if (persisted) {
          const match = res.tasks.find((t) => t.id === persisted.taskId);
          if (match) return match;
        }
        return null;
      });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setAuthState('guest');
        setData(null);
        setSelectedTask(null);
      } else if (err instanceof PendingApprovalError) {
        setAuthState('pending');
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

  // Al montar: resolver el estado de login antes de pedir datos, para
  // distinguir "sin sesión" de "cuenta pendiente de aprobación".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await getAuthStatus();
        if (cancelled) return;
        if (!status.authed) {
          setAuthState('guest');
          return;
        }
        setAuthEmail(status.user.email);
        if (!status.approved) {
          setAuthState('pending');
          return;
        }
        void refresh();
      } catch {
        if (!cancelled) setAuthState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const guardIfRunning = useCallback(
    (message: string, run: () => void) => {
      if (timerPhase !== 'idle') setPendingSwitch({ message, run });
      else run();
    },
    [timerPhase]
  );

  const guardedSelectTask = useCallback(
    (task: Task) => {
      if (task.id === selectedTask?.id) return;
      guardIfRunning('Cambiar de tarea lo cancela sin guardar esa sesión.', () => setSelectedTask(task));
    },
    [selectedTask, guardIfRunning]
  );

  const guardedSelectDay = useCallback(
    (day: string) => {
      if (day === data?.selectedDay) return;
      guardIfRunning('Cambiar de día lo cancela sin guardar esa sesión.', () =>
        void refresh(day, data?.week)
      );
    },
    [data, refresh, guardIfRunning]
  );

  // weekLabel === undefined => volver a la semana actual (hoy).
  const guardedGoToWeek = useCallback(
    (weekLabel: string | undefined) => {
      guardIfRunning('Cambiar de semana lo cancela sin guardar esa sesión.', () =>
        void refresh(undefined, weekLabel)
      );
    },
    [refresh, guardIfRunning]
  );

  const guardedSelectFile = useCallback(
    (fileId: string) => {
      if (fileId === selectedFileId) return;
      guardIfRunning('Cambiar de archivo lo cancela sin guardar esa sesión.', () => {
        setSelectedFileId(fileId);
        selectedFileIdRef.current = fileId;
        localStorage.setItem(FILE_STORAGE_KEY, fileId);
        void refresh(undefined, undefined, fileId);
      });
    },
    [selectedFileId, guardIfRunning, refresh]
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
      if (isTyping || pendingSwitch || authState !== 'authed' || !data) return;

      if (e.key === ' ') {
        e.preventDefault();
        if (timerPhase === 'idle') timerRef.current?.start();
        else timerRef.current?.stop();
      } else if (e.key === 't' || e.key === 'T') {
        toggleTheme();
      } else if (/^[1-5]$/.test(e.key)) {
        const day = data.days[Number(e.key) - 1]?.day;
        if (day) guardedSelectDay(day);
      } else if (e.key === '[') {
        guardedGoToWeek(data.previousWeekLabel);
      } else if (e.key === ']') {
        guardedGoToWeek(data.nextWeekLabel);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [timerPhase, data, pendingSwitch, authState, toggleTheme, guardedSelectDay, guardedGoToWeek]);

  function handleSessionLogged(taskId: string, session: Session) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === taskId ? { ...t, sessions: [...t.sessions, session] } : t
            ),
            dayTotalSeconds: prev.dayTotalSeconds + session.durationSeconds,
            weekTotalSeconds: prev.weekTotalSeconds + session.durationSeconds,
          }
        : prev
    );
  }

  function handleSessionDeleted(taskId: string, sessionId: string) {
    setData((prev) => {
      if (!prev) return prev;
      const removed = prev.tasks
        .find((t) => t.id === taskId)
        ?.sessions.find((s) => s.id === sessionId)?.durationSeconds ?? 0;
      return {
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === taskId ? { ...t, sessions: t.sessions.filter((s) => s.id !== sessionId) } : t
        ),
        dayTotalSeconds: prev.dayTotalSeconds - removed,
        weekTotalSeconds: prev.weekTotalSeconds - removed,
      };
    });
  }

  function setTaskDone(id: string, done: boolean) {
    setData((prev) =>
      prev ? { ...prev, tasks: prev.tasks.map((t) => (t.id === id ? { ...t, done } : t)) } : prev
    );
  }

  async function handleToggleDone(task: Task) {
    const next = !task.done;
    setTogglingIds((prev) => new Set(prev).add(task.id));
    setTaskDone(task.id, next); // optimista
    try {
      await updateTaskDone(task.id, next);
    } catch (err) {
      setTaskDone(task.id, task.done); // revertir
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la tarea');
    } finally {
      setTogglingIds((prev) => {
        const s = new Set(prev);
        s.delete(task.id);
        return s;
      });
    }
  }

  function handleTaskCreated(task: Task) {
    setData((prev) => (prev ? { ...prev, tasks: [...prev.tasks, task] } : prev));
  }

  function handleTaskDeleted(id: string) {
    setData((prev) => {
      if (!prev) return prev;
      const removed = prev.tasks
        .find((t) => t.id === id)
        ?.sessions.reduce((s, ses) => s + ses.durationSeconds, 0) ?? 0;
      return {
        ...prev,
        tasks: prev.tasks.filter((t) => t.id !== id),
        dayTotalSeconds: prev.dayTotalSeconds - removed,
        weekTotalSeconds: prev.weekTotalSeconds - removed,
      };
    });
    setSelectedTask((prev) => (prev?.id === id ? null : prev));
  }

  function handleTaskTextUpdated(id: string, name: string) {
    setData((prev) =>
      prev ? { ...prev, tasks: prev.tasks.map((t) => (t.id === id ? { ...t, name } : t)) } : prev
    );
    setSelectedTask((prev) => (prev?.id === id ? { ...prev, name } : prev));
  }

  function handleSessionUpdated(taskId: string, session: Session) {
    setData((prev) => {
      if (!prev) return prev;
      let delta = 0;
      const tasks = prev.tasks.map((t) => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          sessions: t.sessions.map((s) => {
            if (s.id !== session.id) return s;
            delta = session.durationSeconds - s.durationSeconds;
            return session;
          }),
        };
      });
      return {
        ...prev,
        tasks,
        dayTotalSeconds: prev.dayTotalSeconds + delta,
        weekTotalSeconds: prev.weekTotalSeconds + delta,
      };
    });
  }

  async function handleReorderTask(task: Task, targetIndex: number) {
    if (!data) return;
    const afterId = computeAfterId(data.tasks, task.id, targetIndex);
    const originalTasks = data.tasks;
    const originalIndex = originalTasks.findIndex((t) => t.id === task.id);
    if (originalIndex === -1) return;

    const reordered = [...originalTasks];
    reordered.splice(originalIndex, 1);
    reordered.splice(Math.max(0, Math.min(targetIndex, reordered.length)), 0, task);
    setData((prev) => (prev ? { ...prev, tasks: reordered } : prev));
    setBusyTaskIds((prev) => new Set(prev).add(task.id));

    try {
      await moveTask(task.id, { afterId });
      void refresh(data.selectedDay, data.week);
    } catch (err) {
      setData((prev) => (prev ? { ...prev, tasks: originalTasks } : prev));
      setError(err instanceof Error ? err.message : 'No se pudo reordenar la tarea');
    } finally {
      setBusyTaskIds((prev) => {
        const s = new Set(prev);
        s.delete(task.id);
        return s;
      });
    }
  }

  async function handleMoveTask(task: Task, target: MoveTarget) {
    if (!data) return;
    const originalTasks = data.tasks;
    const { selectedDay, week } = data;

    setData((prev) => (prev ? { ...prev, tasks: prev.tasks.filter((t) => t.id !== task.id) } : prev));
    setSelectedTask((prev) => (prev?.id === task.id ? null : prev));
    setBusyTaskIds((prev) => new Set(prev).add(task.id));

    try {
      await moveTask(task.id, { date: target.date });
      void refresh(selectedDay, week);
    } catch (err) {
      setData((prev) => (prev ? { ...prev, tasks: originalTasks } : prev));
      setError(err instanceof Error ? err.message : `No se pudo mover la tarea a ${target.destLabel}`);
    } finally {
      setBusyTaskIds((prev) => {
        const s = new Set(prev);
        s.delete(task.id);
        return s;
      });
    }
  }

  async function handleCarryOver() {
    if (!data) return;
    setCarryingOver(true);
    setError(null);
    try {
      const res = await carryOverToToday(selectedFileId ?? undefined);
      if (res.moved > 0) void refresh(data.selectedDay, data.week);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron traer las tareas');
    } finally {
      setCarryingOver(false);
    }
  }

  // Carry-over automático: una vez por sesión, si está activado y hay
  // pendientes, apenas cargan los datos.
  useEffect(() => {
    if (!carryOverAuto || carryOverDoneRef.current) return;
    if (!data || data.carryOverCount === 0) return;
    carryOverDoneRef.current = true;
    void (async () => {
      try {
        const res = await carryOverToToday(selectedFileIdRef.current ?? undefined);
        if (res.moved > 0) void refresh(data.selectedDay, data.week);
      } catch {
        // silencioso — el usuario igual ve el banner y puede hacerlo a mano
      }
    })();
  }, [carryOverAuto, data, refresh]);

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // aunque falle el borrado server-side, sacamos al usuario igual
    }
    setAuthState('guest');
    setAuthEmail(null);
    setData(null);
    setSelectedTask(null);
    filesLoadedRef.current = false;
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

  const soundToggleButton = (
    <button
      type="button"
      className="btn btn-icon"
      onClick={toggleSounds}
      title={soundsEnabled ? 'Desactivar sonidos' : 'Activar sonidos'}
      aria-label={soundsEnabled ? 'Desactivar sonidos' : 'Activar sonidos'}
    >
      {soundsEnabled ? <SoundOnIcon /> : <SoundOffIcon />}
    </button>
  );

  const notificationsTitle =
    notifications.permission === 'denied'
      ? 'Notificaciones bloqueadas en el navegador'
      : notifications.enabled
        ? 'Desactivar notificaciones'
        : 'Avisar el cambio de fase con una notificación';
  const notificationToggleButton = notifications.permission !== 'unsupported' && (
    <button
      type="button"
      className="btn btn-icon"
      onClick={() => void notifications.toggle()}
      disabled={notifications.permission === 'denied'}
      title={notificationsTitle}
      aria-label={notificationsTitle}
    >
      {notifications.enabled ? <BellOnIcon /> : <BellOffIcon />}
    </button>
  );

  if (authState === 'checking') {
    return (
      <div className="center-screen">
        <div className="screen-content">
          <p className="muted">Cargando…</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (authState === 'guest') {
    return <Login />;
  }

  if (authState === 'pending') {
    return <PendingApproval email={authEmail} onLogout={() => void handleLogout()} />;
  }

  if (authState === 'error') {
    return (
      <div className="login-screen">
        <div className="screen-content">
          <div className="login-card">
            <h1>pomotion</h1>
            <p className="error">{error ?? 'No se pudo conectar con el servidor'}</p>
            <button
              type="button"
              className="btn btn-filled"
              onClick={() => void refresh()}
              disabled={loading}
            >
              {loading ? 'Reintentando…' : 'Reintentar'}
            </button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>pomotion</h1>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => setShowReport(true)}
            title="Reporte de tiempo"
            aria-label="Reporte de tiempo"
          >
            <ReportIcon />
          </button>
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => setShowRecurring(true)}
            title="Tareas recurrentes"
            aria-label="Tareas recurrentes"
          >
            <RepeatIcon />
          </button>
          {soundToggleButton}
          {notificationToggleButton}
          {themeToggleButton}
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => void refresh(data?.selectedDay, data?.week)}
            disabled={loading}
            title="Actualizar"
            aria-label="Actualizar"
          >
            <RefreshIcon spinning={loading} />
          </button>
          <button type="button" className="btn btn-plain" onClick={() => void handleLogout()}>
            Salir
          </button>
        </div>
      </header>

      <FileSelector
        files={files}
        selectedFileId={selectedFileId}
        onSelectFile={guardedSelectFile}
        loading={loading}
      />

      {error && <p className="error banner">{error}</p>}
      {recurringNotice && (
        <DismissibleBanner key={recurringNotice.n} tone="success" message={recurringNotice.text} />
      )}
      {data && data.carryOverCount > 0 && (
        <CarryOverBanner
          count={data.carryOverCount}
          auto={carryOverAuto}
          onToggleAuto={toggleCarryOverAuto}
          onCarryOver={() => void handleCarryOver()}
          busy={carryingOver}
        />
      )}

      {data && (
        <>
          <div className="day-row">
            <DaySelector
              week={data.week}
              days={data.days.map((d) => d.day)}
              selectedDay={data.selectedDay}
              onSelectDay={guardedSelectDay}
              isCurrentWeek={data.isCurrentWeek}
              onPreviousWeek={() => guardedGoToWeek(data.previousWeekLabel)}
              onNextWeek={() => guardedGoToWeek(data.nextWeekLabel)}
              onGoToCurrentWeek={() => guardedGoToWeek(undefined)}
              loading={loading}
            />
            {data.dayTotalSeconds > 0 && (
              <div className="total-pill" title="Total registrado este día">
                <span className="total-pill-label">Día</span>
                <span className="total-pill-value">{formatDurationLabel(data.dayTotalSeconds)}</span>
              </div>
            )}
            {data.weekTotalSeconds > 0 && (
              <div className="total-pill" title="Total registrado esta semana">
                <span className="total-pill-label">Semana</span>
                <span className="total-pill-value">{formatDurationLabel(data.weekTotalSeconds)}</span>
              </div>
            )}
          </div>

          <div className="main-grid">
            <section className="tasks-panel card">
              <TaskList
                tasks={data.tasks}
                selectedTaskId={selectedTask?.id ?? null}
                onSelect={guardedSelectTask}
                onToggleDone={(task) => void handleToggleDone(task)}
                togglingIds={togglingIds}
                onSessionDeleted={handleSessionDeleted}
                selectedDay={data.selectedDay}
                selectedDate={data.selectedDate}
                days={data.days}
                previousWeekLabel={data.previousWeekLabel}
                nextWeekLabel={data.nextWeekLabel}
                fileId={selectedFileId}
                lockedTaskId={lockedTaskId}
                busyTaskIds={busyTaskIds}
                onTaskCreated={handleTaskCreated}
                onTaskDeleted={handleTaskDeleted}
                onTaskTextUpdated={handleTaskTextUpdated}
                onReorderTask={(task, targetIndex) => void handleReorderTask(task, targetIndex)}
                onMoveTask={(task, target) => void handleMoveTask(task, target)}
                onSessionUpdated={handleSessionUpdated}
                onManualSessionAdded={handleSessionLogged}
              />
            </section>

            <section className="timer-panel card">
              <Timer
                ref={timerRef}
                task={selectedTask}
                onSessionLogged={handleSessionLogged}
                onPhaseChange={setTimerPhase}
                soundsEnabled={soundsEnabled}
                notificationsEnabled={notifications.enabled}
              />
            </section>
          </div>

          <footer className="shortcuts-hint">
            <kbd>espacio</kbd> inicia/detiene · <kbd>1</kbd>–<kbd>5</kbd> cambia de día ·{' '}
            <kbd>[</kbd>/<kbd>]</kbd> cambia de semana · <kbd>T</kbd> cambia el tema
          </footer>
        </>
      )}

      <Footer />

      {showReport && <Report fileId={selectedFileId} onClose={() => setShowReport(false)} />}

      {showRecurring && data && (
        <RecurringTasksDialog
          fileId={selectedFileId}
          currentWeek={data.week}
          onClose={() => setShowRecurring(false)}
          onApplied={(added) => {
            setRecurringNotice((prev) => ({
              n: (prev?.n ?? 0) + 1,
              text:
                added === 0
                  ? 'Las recurrentes ya estaban en la semana.'
                  : `${added} ${added === 1 ? 'tarea recurrente agregada' : 'tareas recurrentes agregadas'}.`,
            }));
            void refresh(data.selectedDay, data.week);
          }}
        />
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
