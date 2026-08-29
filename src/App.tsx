import { useCallback, useEffect, useRef, useState } from 'react';
import {
  carryOverToToday,
  getAuthStatus,
  getFiles,
  getTasks,
  logout,
  moveTask,
  moveTaskToInbox,
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
import MonthView from './components/MonthView';
import FocusHeatmap from './components/FocusHeatmap';
import Inbox from './components/Inbox';
import Menu, { MenuItem } from './components/Menu';
import TagsDialog from './components/TagsDialog';
import type { MoveTarget } from './components/TaskRowMenu';
import TaskList from './components/TaskList';
import Timer, { type TimerHandle } from './components/Timer';
import { formatDurationLabel } from './duration';
import { tagColorOf } from './tags';
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

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
      <circle cx="12" cy="5" r="1.85" />
      <circle cx="12" cy="12" r="1.85" />
      <circle cx="12" cy="19" r="1.85" />
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
  const [showMonth, setShowMonth] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showRecurring, setShowRecurring] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [filterTagId, setFilterTagId] = useState<string | null>(null);
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

  // Suma de las estimaciones de las tareas del día visible (para el pill
  // "plan vs. real"). En segundos, para reusar formatDurationLabel.
  const dayEstimateSeconds =
    (data?.tasks ?? []).reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0) * 60;

  // Si la etiqueta del filtro dejó de existir (se borró, o cambió de
  // contexto), limpiar el filtro.
  useEffect(() => {
    if (filterTagId && data && !data.tags.some((t) => t.id === filterTagId)) {
      setFilterTagId(null);
    }
  }, [data, filterTagId]);

  const visibleTasks =
    filterTagId && data
      ? data.tasks.filter((t) => t.tagIds.includes(filterTagId))
      : (data?.tasks ?? []);

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

  // Desde la vista mensual: saltar a un día concreto (semana + día ya resueltos).
  const guardedGoToDate = useCallback(
    (week: string, day: string) => {
      setShowMonth(false);
      guardIfRunning('Cambiar de día lo cancela sin guardar esa sesión.', () =>
        void refresh(day, week)
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

  function handleTaskUpdated(id: string, patch: Partial<Task>) {
    setData((prev) =>
      prev ? { ...prev, tasks: prev.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) } : prev
    );
    setSelectedTask((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
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

  // --- Inbox (tareas sin fecha) ---

  function handleInboxCreated(task: Task) {
    setData((prev) => (prev ? { ...prev, inbox: [...prev.inbox, task] } : prev));
  }

  function handleInboxDeleted(id: string) {
    setData((prev) => (prev ? { ...prev, inbox: prev.inbox.filter((t) => t.id !== id) } : prev));
  }

  function handleInboxTextUpdated(id: string, name: string) {
    setData((prev) =>
      prev ? { ...prev, inbox: prev.inbox.map((t) => (t.id === id ? { ...t, name } : t)) } : prev
    );
  }

  async function handleScheduleTask(task: Task, date: string) {
    if (!data) return;
    const { selectedDay, week } = data;
    setData((prev) => (prev ? { ...prev, inbox: prev.inbox.filter((t) => t.id !== task.id) } : prev));
    setBusyTaskIds((prev) => new Set(prev).add(task.id));
    try {
      await moveTask(task.id, { date });
      void refresh(selectedDay, week);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo programar la tarea');
      void refresh(selectedDay, week); // restaura el inbox
    } finally {
      setBusyTaskIds((prev) => {
        const s = new Set(prev);
        s.delete(task.id);
        return s;
      });
    }
  }

  async function handleSendToInbox(task: Task) {
    if (!data) return;
    const { selectedDay, week } = data;
    setData((prev) => (prev ? { ...prev, tasks: prev.tasks.filter((t) => t.id !== task.id) } : prev));
    setSelectedTask((prev) => (prev?.id === task.id ? null : prev));
    setBusyTaskIds((prev) => new Set(prev).add(task.id));
    try {
      await moveTaskToInbox(task.id);
      void refresh(selectedDay, week);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo sacar de la agenda');
      void refresh(selectedDay, week);
    } finally {
      setBusyTaskIds((prev) => {
        const s = new Set(prev);
        s.delete(task.id);
        return s;
      });
    }
  }

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

  const notificationsState =
    notifications.permission === 'denied'
      ? 'Bloqueadas'
      : notifications.enabled
        ? 'Sí'
        : 'No';

  const viewMenu = (
    <Menu ariaLabel="Ver" trigger={<>Ver<ChevronDownIcon /></>}>
      {(close) => (
        <>
          <MenuItem onClick={() => { setShowMonth(true); close(); }}>Vista mensual</MenuItem>
          <MenuItem onClick={() => { setShowHeatmap(true); close(); }}>Heatmap de foco</MenuItem>
          <MenuItem onClick={() => { setShowReport(true); close(); }}>Reporte de tiempo</MenuItem>
          <MenuItem onClick={() => { setShowRecurring(true); close(); }}>Tareas recurrentes</MenuItem>
          <MenuItem onClick={() => { setShowTags(true); close(); }}>Etiquetas</MenuItem>
        </>
      )}
    </Menu>
  );

  const moreMenu = (
    <Menu ariaLabel="Más opciones" triggerClassName="btn btn-icon" trigger={<MoreIcon />}>
      {(close) => (
        <>
          <div className="menu-heading">Ajustes</div>
          <MenuItem onClick={toggleSounds} state={soundsEnabled ? 'Sí' : 'No'}>
            Sonidos
          </MenuItem>
          {notifications.permission !== 'unsupported' && (
            <MenuItem
              onClick={() => void notifications.toggle()}
              disabled={notifications.permission === 'denied'}
              state={notificationsState}
            >
              Notificaciones
            </MenuItem>
          )}
          <MenuItem onClick={toggleCarryOverAuto} state={carryOverAuto ? 'Sí' : 'No'}>
            Traer pendientes al abrir
          </MenuItem>
          <div className="menu-sep" />
          <MenuItem
            onClick={() => { void refresh(data?.selectedDay, data?.week); close(); }}
            disabled={loading}
          >
            Actualizar
          </MenuItem>
          <MenuItem danger onClick={() => { close(); void handleLogout(); }}>
            Salir
          </MenuItem>
        </>
      )}
    </Menu>
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
          {themeToggleButton}
          {viewMenu}
          {moreMenu}
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
            {(data.dayTotalSeconds > 0 ||
              data.weekTotalSeconds > 0 ||
              dayEstimateSeconds > 0) && (
              <div className="total-pill" title="Tiempo registrado y estimado">
                {data.dayTotalSeconds > 0 && (
                  <span className="total-seg">
                    <span className="total-pill-label">Día</span>
                    <span className="total-pill-value">
                      {formatDurationLabel(data.dayTotalSeconds)}
                    </span>
                  </span>
                )}
                {dayEstimateSeconds > 0 && (
                  <span className="total-seg">
                    <span className="total-pill-label">Est</span>
                    <span className="total-pill-value total-pill-est">
                      {formatDurationLabel(dayEstimateSeconds)}
                    </span>
                  </span>
                )}
                {data.weekTotalSeconds > 0 && (
                  <span className="total-seg">
                    <span className="total-pill-label">Sem</span>
                    <span className="total-pill-value">
                      {formatDurationLabel(data.weekTotalSeconds)}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>

          <Inbox
            tasks={data.inbox}
            days={data.days}
            fileId={selectedFileId}
            onCreated={handleInboxCreated}
            onDeleted={handleInboxDeleted}
            onTextUpdated={handleInboxTextUpdated}
            onSchedule={(task, date) => void handleScheduleTask(task, date)}
          />

          <div className="main-grid">
            <section className="tasks-panel card">
              {data.tags.length > 0 && (
                <div className="tag-filter" role="group" aria-label="Filtrar por etiqueta">
                  <button
                    type="button"
                    className={filterTagId ? 'tag-filter-chip' : 'tag-filter-chip is-on'}
                    onClick={() => setFilterTagId(null)}
                  >
                    Todas
                  </button>
                  {data.tags.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      data-tag-color={tagColorOf(t.color)}
                      className={
                        filterTagId === t.id
                          ? 'tag-filter-chip tag-filter-chip--color is-on'
                          : 'tag-filter-chip tag-filter-chip--color'
                      }
                      onClick={() => setFilterTagId((cur) => (cur === t.id ? null : t.id))}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
              <TaskList
                tasks={visibleTasks}
                selectedTaskId={selectedTask?.id ?? null}
                onSelect={guardedSelectTask}
                onToggleDone={(task) => void handleToggleDone(task)}
                togglingIds={togglingIds}
                onSessionDeleted={handleSessionDeleted}
                selectedDay={data.selectedDay}
                selectedDate={data.selectedDate}
                today={data.today}
                days={data.days}
                previousWeekLabel={data.previousWeekLabel}
                nextWeekLabel={data.nextWeekLabel}
                fileId={selectedFileId}
                allTags={data.tags}
                onManageTags={() => setShowTags(true)}
                canReorder={!filterTagId}
                lockedTaskId={lockedTaskId}
                busyTaskIds={busyTaskIds}
                onTaskCreated={handleTaskCreated}
                onTaskDeleted={handleTaskDeleted}
                onTaskTextUpdated={handleTaskTextUpdated}
                onTaskUpdated={handleTaskUpdated}
                onReorderTask={(task, targetIndex) => void handleReorderTask(task, targetIndex)}
                onMoveTask={(task, target) => void handleMoveTask(task, target)}
                onSendToInbox={(task) => void handleSendToInbox(task)}
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

      {showMonth && (
        <MonthView
          fileId={selectedFileId}
          initialMonth={data?.selectedDate?.slice(0, 7)}
          onPick={guardedGoToDate}
          onClose={() => setShowMonth(false)}
        />
      )}

      {showHeatmap && (
        <FocusHeatmap fileId={selectedFileId} onClose={() => setShowHeatmap(false)} />
      )}

      {showTags && data && (
        <TagsDialog
          tags={data.tags}
          onChanged={() => void refresh(data.selectedDay, data.week)}
          onClose={() => setShowTags(false)}
        />
      )}

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
