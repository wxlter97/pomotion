import { useCallback, useEffect, useRef, useState } from 'react';
import { createWeek, getFiles, getNextWeekSuggestion, getTasks, logout, reorderTask, UnauthorizedError, updateTaskChecked } from './api';
import ConfirmDialog from './components/ConfirmDialog';
import DaySelector from './components/DaySelector';
import DismissibleBanner from './components/DismissibleBanner';
import FileSelector from './components/FileSelector';
import Footer from './components/Footer';
import Login from './components/Login';
import TaskList from './components/TaskList';
import Timer, { type TimerHandle } from './components/Timer';
import { computeAfterBlockId } from './taskReorder';
import { loadActiveTimer } from './timerStorage';
import type { FileEntry, Session, Task, TasksResponse, TimerPhase } from './types';
import { useSoundSetting } from './useSoundSetting';
import { useTheme } from './useTheme';

type AuthState = 'checking' | 'authed' | 'guest' | 'error';
type PendingSwitch = { message: string; run: () => void };

const FILE_STORAGE_KEY = 'pomotion:file';

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
  const [data, setData] = useState<TasksResponse | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timerPhase, setTimerPhase] = useState<TimerPhase>('idle');
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [busyTaskIds, setBusyTaskIds] = useState<Set<string>>(new Set());
  const [pendingNewWeek, setPendingNewWeek] = useState<{ start: string; end: string; label: string } | null>(
    null
  );
  const [addingWeek, setAddingWeek] = useState(false);
  const [addWeekError, setAddWeekError] = useState<string | null>(null);
  const [theme, toggleTheme] = useTheme();
  const [soundsEnabled, toggleSounds] = useSoundSetting();
  const timerRef = useRef<TimerHandle>(null);

  // Selector de archivo (Trabajo/Casa/Hábitos, etc.). `files` queda vacío
  // si no hay NOTION_FILES_INDEX_PAGE_ID configurada — modo de un solo
  // archivo, retrocompatible, el selector ni aparece. selectedFileIdRef
  // espeja el estado para que `refresh` pueda leerlo sin necesitar la
  // dependencia (mismo patrón que ya usa day/week: se pasan explícitos).
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const selectedFileIdRef = useRef<string | null>(null);
  const filesRef = useRef<FileEntry[]>([]);
  const filesLoadedRef = useRef(false);

  // Mientras haya un timer corriendo, la tarea activa queda con sus
  // controles de mover/arrastrar/borrar bloqueados — reordenarla o
  // borrarla le cambiaría (o le quitaría) el blockId por debajo, y
  // Timer.tsx detecta "cambié de tarea" comparando blockId, lo que
  // descartaría la sesión en curso sin guardarla. El resto de tareas del
  // día siguen totalmente editables.
  const lockedTaskBlockId = timerPhase !== 'idle' ? (selectedTask?.blockId ?? null) : null;

  const refresh = useCallback(async (day?: string, week?: string, fileIdParam?: string) => {
    setLoading(true);
    setError(null);
    try {
      let fileId = fileIdParam ?? selectedFileIdRef.current ?? undefined;
      // Solo la primera vez: resuelve la lista de archivos y, si hay más
      // de uno configurado, la selección persistida (o el primero por
      // defecto) — antes de pedir las tareas, para no hacer un segundo
      // round-trip visible al usuario.
      if (!filesLoadedRef.current) {
        const filesRes = await getFiles();
        filesLoadedRef.current = true;
        filesRef.current = filesRes.files;
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
        // No dejar datos de un día/semana/archivo distinto detrás del
        // banner de error — ej. al cambiar a un archivo sin ninguna
        // semana todavía, antes quedaban visibles (y parcialmente
        // editables) las tareas del archivo anterior.
        setData(null);
        setSelectedTask(null);
        setAuthState((prev) => {
          if (prev !== 'checking') return prev;
          // Si hay más de un archivo configurado, no escalar a la
          // pantalla de error de página completa (sin forma de volver al
          // selector) — mejor mostrar el shell de la app con el banner de
          // error, para poder cambiar a otro archivo que sí funcione. Solo
          // sin alternativa (modo de un solo archivo, o si ni siquiera se
          // pudo resolver la lista de archivos) se muestra el error
          // bloqueante de siempre.
          return filesRef.current.length === 0 ? 'error' : 'authed';
        });
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
      guardIfRunning('Cambiar de día lo cancela sin guardar esa sesión.', () => void refresh(day, data?.week ?? undefined));
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

  const guardedSelectFile = useCallback(
    (fileId: string) => {
      if (fileId === selectedFileId) return;
      guardIfRunning('Cambiar de archivo lo cancela sin guardar esa sesión.', () => {
        setSelectedFileId(fileId);
        selectedFileIdRef.current = fileId;
        localStorage.setItem(FILE_STORAGE_KEY, fileId);
        // Sin día/semana explícitos: cada archivo tiene su propia rotación
        // de semanas, así que se vuelve a auto-detectar "hoy" en el nuevo
        // archivo en vez de arrastrar la semana/día que se estaba viendo.
        void refresh(undefined, undefined, fileId);
      });
    },
    [selectedFileId, guardIfRunning, refresh]
  );

  function confirmPendingSwitch() {
    pendingSwitch?.run();
    setPendingSwitch(null);
  }

  async function handleRequestAddWeek() {
    setAddWeekError(null);
    try {
      const suggestion = await getNextWeekSuggestion(selectedFileId ?? undefined);
      setPendingNewWeek(suggestion);
    } catch (err) {
      setAddWeekError(err instanceof Error ? err.message : 'No se pudo calcular la semana siguiente');
    }
  }

  async function confirmAddWeek() {
    if (!pendingNewWeek) return;
    setAddingWeek(true);
    setAddWeekError(null);
    try {
      const res = await createWeek(pendingNewWeek.start, pendingNewWeek.end, selectedFileId ?? undefined);
      setPendingNewWeek(null);
      const newLabel = res.week.label;
      guardIfRunning('Cambiar de semana lo cancela sin guardar esa sesión.', () => void refresh(undefined, newLabel));
    } catch (err) {
      setAddWeekError(err instanceof Error ? err.message : 'No se pudo crear la semana');
    } finally {
      setAddingWeek(false);
    }
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

  function handleTaskTextUpdated(blockId: string, text: string) {
    setData((prev) => {
      if (!prev) return prev;
      return { ...prev, tasks: prev.tasks.map((t) => (t.blockId === blockId ? { ...t, text } : t)) };
    });
    setSelectedTask((prev) => (prev?.blockId === blockId ? { ...prev, text } : prev));
  }

  function handleSessionUpdated(taskBlockId: string, session: Session) {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.blockId === taskBlockId
            ? { ...t, sessions: t.sessions.map((s) => (s.blockId === session.blockId ? session : s)) }
            : t
        ),
      };
    });
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
      void refresh(data.selectedDay ?? undefined, data.week ?? undefined);
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
    return <Login onLoggedIn={() => void refresh()} />;
  }

  if (authState === 'error') {
    return (
      <div className="login-screen">
        <div className="screen-content">
          <div className="login-card">
            <h1>pomotion</h1>
            <p className="error">{error ?? 'No se pudo conectar con el servidor'}</p>
            <button type="button" className="btn btn-filled" onClick={() => void refresh()} disabled={loading}>
              {loading ? 'Reintentando…' : 'Reintentar'}
            </button>
          </div>
        </div>
        <Footer />
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
          {soundToggleButton}
          {themeToggleButton}
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => void refresh(data?.selectedDay ?? undefined, data?.week ?? undefined)}
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
      {addWeekError && <p className="error banner">{addWeekError}</p>}
      {data && data.week && data.weekSource === 'auto-fallback' && (
        <DismissibleBanner
          key={`week-fallback-${data.week}`}
          tone="warning"
          message={`No pude identificar automáticamente la semana actual por fecha — mostrando "${data.week}". Revisa el formato del encabezado en Notion si esto no es correcto.`}
        />
      )}
      {data && !data.dayMatched && (
        <DismissibleBanner
          key={`day-fallback-${data.week}-${data.selectedDay}`}
          tone="warning"
          message={`No encontré el día de hoy en esta semana — mostrando "${data.selectedDay}" por defecto.`}
        />
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
              onAddWeek={() => void handleRequestAddWeek()}
              loading={loading}
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
                {data.week === null
                  ? 'Este archivo todavía no tiene ninguna semana. Usa el botón "+" de arriba para crear la primera.'
                  : 'Esta semana no tiene tareas desglosadas por día en Notion (ej. una semana de vacaciones o feriados). Usa las flechas de arriba para ver otra semana.'}
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
                  onTaskTextUpdated={handleTaskTextUpdated}
                  onReorderTask={(task, targetIndex) => void handleReorderTask(task, targetIndex)}
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

      <Footer />

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

      {pendingNewWeek && (
        <ConfirmDialog
          title="Agregar semana"
          message={`Se creará la semana "${pendingNewWeek.label}" con los cinco días (Lunes–Viernes) vacíos, lista para agregarle tareas.`}
          confirmLabel={addingWeek ? 'Creando…' : 'Crear semana'}
          onConfirm={confirmAddWeek}
          onCancel={() => setPendingNewWeek(null)}
        />
      )}
    </div>
  );
}
