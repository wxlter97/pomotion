import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  bulkTasks,
  carryOverToToday,
  getAuthStatus,
  getFiles,
  getTasks,
  logout,
  syncCalendarFeeds,
  moveTask,
  moveTaskToInbox,
  PendingApprovalError,
  UnauthorizedError,
  updateTaskDone,
  type BulkOp,
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
import DayTemplatesDialog from './components/DayTemplatesDialog';
import GoalsDialog from './components/GoalsDialog';
import CalendarFeedsDialog from './components/CalendarFeedsDialog';
import AdminUsersDialog from './components/AdminUsersDialog';
import BackupDialog from './components/BackupDialog';
import BulkActionBar from './components/BulkActionBar';
import Report from './components/Report';
import SearchDialog from './components/SearchDialog';
import MonthView from './components/MonthView';
import FocusHeatmap from './components/FocusHeatmap';
import Analytics from './components/Analytics';
import DayTimeline from './components/DayTimeline';
import WeeklyReviewDialog from './components/WeeklyReviewDialog';
import Inbox from './components/Inbox';
import DayNote from './components/DayNote';
import Menu, { MenuItem } from './components/Menu';
import TagsDialog from './components/TagsDialog';
import type { MoveTarget } from './components/TaskRowMenu';
import TaskList from './components/TaskList';
import Timer, { type TimerHandle } from './components/Timer';
import TimerSettingsDialog from './components/TimerSettingsDialog';
import { ACCENTS } from './accent';
import { formatDurationLabel } from './duration';
import { tagColorOf } from './tags';
import { computeAfterId } from './taskReorder';
import DragProvider from './drag/DragProvider';
import { computeReorderTarget, type DragItem, type DropZone } from './drag/dnd';
import { LANGS, useLang, useT, type MsgKey } from './i18n';
import { loadActiveTimer } from './timerStorage';
import { dueBannerText } from './dueReminders';
import type { DueReminder, FileEntry, Session, Task, TasksResponse, TimerPhase } from './types';
import { applyUpdate, registerServiceWorker } from './pwa';
import { useAccent } from './useAccent';
import { useCarryOverSetting } from './useCarryOverSetting';
import { useOnlineStatus } from './useOnlineStatus';
import { useDueNotifications } from './useDueNotifications';
import { useTimerSettings } from './useTimerSettings';
import { useNotificationSetting } from './useNotificationSetting';
import { useWeekendSetting } from './useWeekendSetting';
import { useSoundSetting } from './useSoundSetting';
import { usePomodoroSetting } from './usePomodoroSetting';
import { readFileOrder, useFileOrder } from './useFileOrder';
import { orderFiles } from './fileOrder';
import ContextOrderDialog from './components/ContextOrderDialog';
import { useTheme } from './useTheme';

type AuthState = 'checking' | 'authed' | 'guest' | 'pending' | 'error';
type PendingSwitch = { message: string; run: () => void };

const FILE_STORAGE_KEY = 'pomotion:file';
const NO_DUE_REMINDERS: DueReminder[] = [];

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
  const [authIsAdmin, setAuthIsAdmin] = useState(false);
  const [data, setData] = useState<TasksResponse | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timerPhase, setTimerPhase] = useState<TimerPhase>('idle');
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [busyTaskIds, setBusyTaskIds] = useState<Set<string>>(new Set());
  const [showReport, setShowReport] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showMonth, setShowMonth] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showRecurring, setShowRecurring] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showGoals, setShowGoals] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [showFeeds, setShowFeeds] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  // Acciones en lote: selección efímera de tareas. `size > 0` = modo selección.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  // Modo foco: oculta todo menos el timer y la tarea en curso. Efímero.
  const [focusMode, setFocusMode] = useState(false);
  const [showTimerSettings, setShowTimerSettings] = useState(false);
  const [filterTagId, setFilterTagId] = useState<string | null>(null);
  const [recurringNotice, setRecurringNotice] = useState<{ text: string; n: number } | null>(null);
  const [carryingOver, setCarryingOver] = useState(false);
  const online = useOnlineStatus();
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    registerServiceWorker(() => setUpdateReady(true));
  }, []);
  const [theme, toggleTheme] = useTheme();
  const [accent, chooseAccent] = useAccent();
  const [timerSettings, updateTimerSettings, resetTimerSettings] = useTimerSettings();
  const [soundsEnabled, toggleSounds] = useSoundSetting();
  const [pomodoroEnabled, togglePomodoro] = usePomodoroSetting();
  const t = useT();
  const { lang, setLang } = useLang();
  const tRef = useRef(t);
  tRef.current = t;
  const [carryOverAuto, toggleCarryOverAuto] = useCarryOverSetting();
  const [showWeekend, toggleWeekend] = useWeekendSetting();
  const notifications = useNotificationSetting();
  useDueNotifications(data?.dueReminders ?? NO_DUE_REMINDERS, data?.today ?? '', notifications.enabled);
  const timerRef = useRef<TimerHandle>(null);
  const carryOverDoneRef = useRef(false);
  const feedSyncDoneRef = useRef(false);
  const showWeekendRef = useRef(showWeekend);
  useEffect(() => {
    showWeekendRef.current = showWeekend;
  }, [showWeekend]);

  // Selector de archivo (Trabajo/Casa/…). Vacío si el usuario no tiene
  // tareas con `file` → modo de un solo contexto, el selector no aparece.
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [fileOrder, setFileOrder] = useFileOrder();
  const orderedFiles = useMemo(() => orderFiles(files, fileOrder), [files, fileOrder]);
  const [showContextOrder, setShowContextOrder] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const selectedFileIdRef = useRef<string | null>(null);
  const filesLoadedRef = useRef(false);

  const selectMode = selectedIds.size > 0;

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

  const refresh = useCallback(async (
    day?: string,
    week?: string,
    fileIdParam?: string,
    weekendParam?: boolean
  ) => {
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
          const ordered = orderFiles(filesRes.files, readFileOrder());
          fileId = ordered.find((f) => f.id === stored)?.id ?? ordered[0].id;
        }
        if (fileId) {
          setSelectedFileId(fileId);
          selectedFileIdRef.current = fileId;
        }
      }
      const res = await getTasks(day, week, fileId, weekendParam ?? showWeekendRef.current);
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
        setError(err instanceof Error ? err.message : tRef.current('app.loadTasksError'));
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
        setAuthIsAdmin(status.user.isAdmin);
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
      guardIfRunning(tRef.current('guard.switchTask'), () => setSelectedTask(task));
    },
    [selectedTask, guardIfRunning]
  );

  const guardedSelectDay = useCallback(
    (day: string) => {
      if (day === data?.selectedDay) return;
      guardIfRunning(tRef.current('guard.switchDay'), () =>
        void refresh(day, data?.week)
      );
    },
    [data, refresh, guardIfRunning]
  );

  // weekLabel === undefined => volver a la semana actual (hoy).
  const guardedGoToWeek = useCallback(
    (weekLabel: string | undefined) => {
      guardIfRunning(tRef.current('guard.switchWeek'), () =>
        void refresh(undefined, weekLabel)
      );
    },
    [refresh, guardIfRunning]
  );

  // Desde la vista mensual: saltar a un día concreto (semana + día ya resueltos).
  const guardedGoToDate = useCallback(
    (week: string, day: string) => {
      setShowMonth(false);
      guardIfRunning(tRef.current('guard.switchDay'), () =>
        void refresh(day, week)
      );
    },
    [refresh, guardIfRunning]
  );

  // Desde la búsqueda: saltar a la semana/día de la tarea elegida. Las del
  // inbox no tienen semana → solo cerramos (el inbox se ve en cualquier semana).
  const handleSearchPick = useCallback(
    (result: { weekLabel: string | null; day: string | null }) => {
      setShowSearch(false);
      if (!result.weekLabel) return;
      guardIfRunning(tRef.current('guard.switchWeek'), () =>
        void refresh(result.day ?? undefined, result.weekLabel ?? undefined)
      );
    },
    [refresh, guardIfRunning]
  );

  const guardedSelectFile = useCallback(
    (fileId: string) => {
      if (fileId === selectedFileId) return;
      guardIfRunning(tRef.current('guard.switchFile'), () => {
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

      if (e.key === 'Escape' && selectMode) {
        setSelectedIds(new Set());
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        if (timerPhase === 'idle') timerRef.current?.start();
        else timerRef.current?.stop();
      } else if (e.key === 'f' || e.key === 'F') {
        setFocusMode((v) => !v);
      } else if (e.key === 'Escape' && focusMode) {
        setFocusMode(false);
      } else if (e.key === 't' || e.key === 'T') {
        toggleTheme();
      } else if (focusMode) {
        // En modo foco solo valen espacio / F / Esc / T.
      } else if (e.key === '/') {
        e.preventDefault();
        setShowSearch(true);
      } else if (/^[1-7]$/.test(e.key)) {
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
  }, [timerPhase, data, pendingSwitch, authState, focusMode, selectMode, toggleTheme, guardedSelectDay, guardedGoToWeek]);

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
      setError(err instanceof Error ? err.message : tRef.current('taskList.updateError'));
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
      setError(err instanceof Error ? err.message : tRef.current('drag.reorderError'));
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
      setError(err instanceof Error ? err.message : tRef.current('drag.moveError', { dest: target.destLabel }));
    } finally {
      setBusyTaskIds((prev) => {
        const s = new Set(prev);
        s.delete(task.id);
        return s;
      });
    }
  }

  // --- Arrastrar y soltar (pointer events, ver src/drag/) ---

  const canDrop = useCallback(
    (item: DragItem, zone: DropZone): boolean => {
      if (!data) return false;
      if (zone.kind === 'day') {
        const col = data.days.find((d) => d.day === zone.day);
        if (!col) return false;
        // Una tarea del día no se "mueve" a su propio día.
        return !(item.kind === 'task' && col.day === data.selectedDay);
      }
      return true;
    },
    [data]
  );

  const handleDrop = useCallback(
    (item: DragItem, zone: DropZone) => {
      if (!data) return;
      const task = item.task;

      if (zone.kind === 'day') {
        const col = data.days.find((d) => d.day === zone.day);
        if (!col) return;
        if (item.kind === 'task') void handleMoveTask(task, { date: col.date, destLabel: col.day });
        else void handleScheduleTask(task, col.date);
        return;
      }

      if (zone.kind === 'inbox') {
        if (item.kind === 'task' && task.sessions.length === 0) void handleSendToInbox(task);
        return;
      }

      // row | list-end
      if (item.kind === 'inbox') {
        void handleScheduleTask(task, data.selectedDate);
        return;
      }
      const fromIndex = data.tasks.findIndex((t) => t.id === task.id);
      if (fromIndex === -1) return;
      const targetIndex =
        zone.kind === 'list-end'
          ? data.tasks.length - 1
          : computeReorderTarget(fromIndex, zone.index, zone.after);
      void handleReorderTask(task, targetIndex);
    },
    [data]
  );

  function handleToggleWeekend() {
    const next = !showWeekend;
    toggleWeekend();
    void refresh(data?.selectedDay, data?.week, undefined, next);
  }

  async function handleCarryOver() {
    if (!data) return;
    setCarryingOver(true);
    setError(null);
    try {
      const res = await carryOverToToday(selectedFileId ?? undefined, showWeekend);
      if (res.moved > 0) void refresh(data.selectedDay, data.week);
    } catch (err) {
      setError(err instanceof Error ? err.message : tRef.current('carryOver.error'));
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
        const res = await carryOverToToday(selectedFileIdRef.current ?? undefined, showWeekendRef.current);
        if (res.moved > 0) void refresh(data.selectedDay, data.week);
      } catch {
        // silencioso — el usuario igual ve el banner y puede hacerlo a mano
      }
    })();
  }, [carryOverAuto, data, refresh]);

  // Sync de calendarios suscriptos: una vez por sesión, en segundo plano.
  // Los errores por feed se ven en el diálogo de Calendarios.
  useEffect(() => {
    if (authState !== 'authed' || feedSyncDoneRef.current || !data) return;
    feedSyncDoneRef.current = true;
    void (async () => {
      try {
        const res = await syncCalendarFeeds();
        if (res.changed) void refresh(data.selectedDay, data.week);
      } catch {
        // silencioso
      }
    })();
  }, [authState, data, refresh]);

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

  function handleDayNoteSaved(date: string, body: string) {
    // Solo refleja el cambio si seguimos en el mismo día que se editó.
    setData((prev) => (prev && prev.selectedDate === date ? { ...prev, dayNote: body } : prev));
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
      setError(err instanceof Error ? err.message : tRef.current('drag.scheduleError'));
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
      setError(err instanceof Error ? err.message : tRef.current('drag.toInboxError'));
      void refresh(selectedDay, week);
    } finally {
      setBusyTaskIds((prev) => {
        const s = new Set(prev);
        s.delete(task.id);
        return s;
      });
    }
  }

  // --- Acciones en lote ---

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startSelect(id: string) {
    setSelectedIds(new Set([id]));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // La selección es del día/contexto visible: al cambiar, se descarta.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [data?.selectedDate, selectedFileId]);

  async function runBulk(op: BulkOp, opts?: { date?: string; tagId?: string }) {
    if (!data || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    setBulkBusy(true);
    setError(null);
    try {
      const res = await bulkTasks(op, ids, opts);
      clearSelection();
      setPendingBulkDelete(false);
      void refresh(data.selectedDay, data.week);
      if (res.skipped > 0) {
        setRecurringNotice((prev) => ({
          n: (prev?.n ?? 0) + 1,
          text: `${res.affected} ${res.affected === 1 ? 'tarea actualizada' : 'tareas actualizadas'}; ${res.skipped} con tiempo registrado se dejaron en su día.`,
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tRef.current('bulk.error'));
    } finally {
      setBulkBusy(false);
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
    setAuthIsAdmin(false);
    setData(null);
    setSelectedTask(null);
    filesLoadedRef.current = false;
  }

  const themeToggleButton = (
    <button
      type="button"
      className="btn btn-icon"
      onClick={toggleTheme}
      title={t('app.toggleTheme')}
      aria-label={t('app.toggleTheme')}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );

  const notificationsState =
    notifications.permission === 'denied'
      ? t('menu.notificationsBlocked')
      : notifications.enabled
        ? t('common.yes')
        : t('common.no');

  const viewMenu = (
    <Menu ariaLabel={t('menu.view')} trigger={<>{t('menu.view')}<ChevronDownIcon /></>}>
      {(close) => (
        <>
          <MenuItem onClick={() => { setShowSearch(true); close(); }}>{t('menu.search')}</MenuItem>
          <MenuItem onClick={() => { setShowMonth(true); close(); }}>{t('menu.monthView')}</MenuItem>
          <MenuItem onClick={() => { setShowHeatmap(true); close(); }}>{t('menu.heatmap')}</MenuItem>
          <MenuItem onClick={() => { setShowAnalytics(true); close(); }}>{t('menu.analytics')}</MenuItem>
          <MenuItem onClick={() => { setShowTimeline(true); close(); }}>{t('menu.timeline')}</MenuItem>
          <MenuItem onClick={() => { setShowReview(true); close(); }}>{t('menu.weeklyReview')}</MenuItem>
          <MenuItem onClick={() => { setShowGoals(true); close(); }}>{t('menu.goals')}</MenuItem>
          <MenuItem onClick={() => { setShowReport(true); close(); }}>{t('menu.report')}</MenuItem>
          <MenuItem onClick={() => { setShowRecurring(true); close(); }}>{t('menu.recurring')}</MenuItem>
          <MenuItem onClick={() => { setShowTemplates(true); close(); }}>{t('menu.templates')}</MenuItem>
          <MenuItem onClick={() => { setShowTags(true); close(); }}>{t('menu.tags')}</MenuItem>
          <MenuItem onClick={() => { setShowFeeds(true); close(); }}>{t('menu.feeds')}</MenuItem>
        </>
      )}
    </Menu>
  );

  const moreMenu = (
    <Menu ariaLabel={t('menu.more')} triggerClassName="btn btn-icon" trigger={<MoreIcon />}>
      {(close) => (
        <>
          <div className="menu-heading">{t('menu.settings')}</div>
          <MenuItem onClick={toggleSounds} state={soundsEnabled ? t('common.yes') : t('common.no')}>
            {t('menu.sounds')}
          </MenuItem>
          {notifications.permission !== 'unsupported' && (
            <MenuItem
              onClick={() => void notifications.toggle()}
              disabled={notifications.permission === 'denied'}
              state={notificationsState}
            >
              {t('menu.notifications')}
            </MenuItem>
          )}
          <MenuItem onClick={toggleCarryOverAuto} state={carryOverAuto ? t('common.yes') : t('common.no')}>
            {t('menu.carryOverAuto')}
          </MenuItem>
          <MenuItem onClick={handleToggleWeekend} state={showWeekend ? t('common.yes') : t('common.no')}>
            {t('menu.showWeekend')}
          </MenuItem>
          <MenuItem onClick={togglePomodoro} state={pomodoroEnabled ? t('common.yes') : t('common.no')}>
            {t('menu.usePomodoro')}
          </MenuItem>
          {pomodoroEnabled && (
            <MenuItem onClick={() => { setShowTimerSettings(true); close(); }}>
              {t('menu.pomodoroSettings')}
            </MenuItem>
          )}
          <MenuItem
            onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
            state={LANGS.find((l) => l.code === lang)?.label}
          >
            {t('menu.language')}
          </MenuItem>
          <div className="menu-heading">{t('menu.accent')}</div>
          <div className="accent-row" role="group" aria-label={t('menu.accent')}>
            {ACCENTS.map((a) => (
              <button
                key={a.key}
                type="button"
                className={accent === a.key ? 'accent-swatch is-on' : 'accent-swatch'}
                data-accent={a.key}
                title={t(`accent.${a.key}` as MsgKey)}
                aria-label={t(`accent.${a.key}` as MsgKey)}
                aria-pressed={accent === a.key}
                onClick={() => chooseAccent(a.key)}
              />
            ))}
          </div>
          <div className="menu-sep" />
          <MenuItem onClick={() => { setFocusMode(true); close(); }}>{t('menu.focusMode')}</MenuItem>
          {orderedFiles.length > 1 && (
            <MenuItem onClick={() => { setShowContextOrder(true); close(); }}>
              {t('menu.contextOrder')}
            </MenuItem>
          )}
          <MenuItem onClick={() => { setShowBackup(true); close(); }}>{t('menu.backup')}</MenuItem>
          {authIsAdmin && (
            <MenuItem onClick={() => { setShowAdmin(true); close(); }}>{t('menu.approveUsers')}</MenuItem>
          )}
          <MenuItem
            onClick={() => { void refresh(data?.selectedDay, data?.week); close(); }}
            disabled={loading}
          >
            {t('app.refresh')}
          </MenuItem>
          <MenuItem danger onClick={() => { close(); void handleLogout(); }}>
            {t('menu.logout')}
          </MenuItem>
        </>
      )}
    </Menu>
  );

  if (authState === 'checking') {
    return (
      <div className="center-screen">
        <div className="screen-content">
          <p className="muted">{t('common.loading')}</p>
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
            <p className="error">{error ?? t('app.serverError')}</p>
            <button
              type="button"
              className="btn btn-filled"
              onClick={() => void refresh()}
              disabled={loading}
            >
              {loading ? t('common.retrying') : t('common.retry')}
            </button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <DragProvider canDrop={canDrop} onDrop={handleDrop}>
    <div className={focusMode ? 'app app--focus' : 'app'}>
      {focusMode && (
        <button
          type="button"
          className="focus-exit"
          onClick={() => setFocusMode(false)}
          title={t('app.exitFocusTitle')}
        >
          {t('app.exitFocus')}
        </button>
      )}
      <header className="app-header">
        <h1>pomotion</h1>
        <div className="header-actions">
          {themeToggleButton}
          {viewMenu}
          {moreMenu}
        </div>
      </header>

      <FileSelector
        files={orderedFiles}
        selectedFileId={selectedFileId}
        onSelectFile={guardedSelectFile}
        loading={loading}
      />

      {!online && <div className="warning banner">{t('app.offline')}</div>}
      {updateReady && (
        <div className="info banner pwa-update-banner">
          <span>{t('app.updateReady')}</span>
          <button type="button" className="btn btn-tinted btn-small" onClick={applyUpdate}>
            {t('app.update')}
          </button>
        </div>
      )}

      {error && <p className="error banner">{error}</p>}
      {recurringNotice && (
        <DismissibleBanner key={recurringNotice.n} tone="success" message={recurringNotice.text} />
      )}
      {data && data.dueReminders.length > 0 && (
        <DismissibleBanner
          key={`due:${data.today}:${data.dueReminders.map((r) => r.id).join(',')}`}
          tone="warning"
          message={dueBannerText(data.dueReminders, data.today, t)}
        />
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
              <div className="total-pill" title={t("total.title")}>
                {data.dayTotalSeconds > 0 && (
                  <span className="total-seg">
                    <span className="total-pill-label">{t("total.day")}</span>
                    <span className="total-pill-value">
                      {formatDurationLabel(data.dayTotalSeconds)}
                    </span>
                  </span>
                )}
                {dayEstimateSeconds > 0 && (
                  <span className="total-seg">
                    <span className="total-pill-label">{t("total.estimate")}</span>
                    <span className="total-pill-value total-pill-est">
                      {formatDurationLabel(dayEstimateSeconds)}
                    </span>
                  </span>
                )}
                {data.weekTotalSeconds > 0 && (
                  <span className="total-seg">
                    <span className="total-pill-label">{t("total.week")}</span>
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
            fileId={selectedFileId}
            onCreated={handleInboxCreated}
            onDeleted={handleInboxDeleted}
            onTextUpdated={handleInboxTextUpdated}
          />

          <DayNote
            key={data.selectedDate}
            date={data.selectedDate}
            note={data.dayNote}
            onSaved={handleDayNoteSaved}
          />

          <div className="main-grid">
            <section className="tasks-panel card">
              {selectMode && (
                <BulkActionBar
                  count={selectedIds.size}
                  days={data.days}
                  currentDay={data.selectedDay}
                  tags={data.tags}
                  busy={bulkBusy}
                  onComplete={() => void runBulk('complete')}
                  onMove={(date) => void runBulk('move', { date })}
                  onAddTag={(tagId) => void runBulk('add_tag', { tagId })}
                  onInbox={() => void runBulk('inbox')}
                  onDelete={() => setPendingBulkDelete(true)}
                  onCancel={clearSelection}
                />
              )}
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
                selectedDate={data.selectedDate}
                today={data.today}
                previousWeekLabel={data.previousWeekLabel}
                nextWeekLabel={data.nextWeekLabel}
                fileId={selectedFileId}
                allTags={data.tags}
                onManageTags={() => setShowTags(true)}
                canReorder={!filterTagId}
                lockedTaskId={lockedTaskId}
                busyTaskIds={busyTaskIds}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onStartSelect={startSelect}
                onTaskCreated={handleTaskCreated}
                onTaskDeleted={handleTaskDeleted}
                onTaskTextUpdated={handleTaskTextUpdated}
                onTaskUpdated={handleTaskUpdated}
                onMoveTask={(task, target) => void handleMoveTask(task, target)}
                onSendToInbox={(task) => void handleSendToInbox(task)}
                onSessionUpdated={handleSessionUpdated}
                onManualSessionAdded={handleSessionLogged}
              />
            </section>

            <section className="timer-panel card">
              {focusMode && timerPhase !== 'work' && (
                <p className="focus-task">
                  {selectedTask?.name ?? t("app.noTaskSelected")}
                </p>
              )}
              <Timer
                ref={timerRef}
                task={selectedTask}
                settings={timerSettings}
                onSessionLogged={handleSessionLogged}
                onPhaseChange={setTimerPhase}
                soundsEnabled={soundsEnabled}
                notificationsEnabled={notifications.enabled}
                pomodoroEnabled={pomodoroEnabled}
              />
            </section>
          </div>

          <footer className="shortcuts-hint">
            <kbd>{t('shortcut.space')}</kbd> {t('shortcut.startStop')} · <kbd>1</kbd>–<kbd>5</kbd>{' '}
            {t('shortcut.switchDay')} · <kbd>[</kbd>/<kbd>]</kbd> {t('shortcut.switchWeek')} ·{' '}
            <kbd>/</kbd> {t('shortcut.search')} · <kbd>T</kbd> {t('shortcut.toggleTheme')}
          </footer>
        </>
      )}

      <Footer />

      {showReport && <Report fileId={selectedFileId} onClose={() => setShowReport(false)} />}

      {showSearch && (
        <SearchDialog
          fileId={selectedFileId}
          showContext={files.length > 1}
          onPick={handleSearchPick}
          onClose={() => setShowSearch(false)}
        />
      )}

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

      {showAnalytics && (
        <Analytics fileId={selectedFileId} onClose={() => setShowAnalytics(false)} />
      )}

      {showTimeline && data && (
        <DayTimeline
          tasks={data.tasks}
          selectedDate={data.selectedDate}
          today={data.today}
          allTags={data.tags}
          onManageTags={() => setShowTags(true)}
          onTaskUpdated={handleTaskUpdated}
          onClose={() => setShowTimeline(false)}
        />
      )}

      {showReview && data && (
        <WeeklyReviewDialog
          initialWeek={data.week}
          onChanged={() => void refresh(data.selectedDay, data.week)}
          onClose={() => setShowReview(false)}
        />
      )}

      {showGoals && data && (
        <GoalsDialog
          tags={data.tags}
          fileId={selectedFileId}
          onClose={() => setShowGoals(false)}
        />
      )}

      {showFeeds && (
        <CalendarFeedsDialog
          files={orderedFiles}
          onChanged={() => void refresh(data?.selectedDay, data?.week)}
          onClose={() => setShowFeeds(false)}
        />
      )}

      {showAdmin && <AdminUsersDialog onClose={() => setShowAdmin(false)} />}

      {showBackup && <BackupDialog onClose={() => setShowBackup(false)} />}

      {showContextOrder && (
        <ContextOrderDialog
          files={orderedFiles}
          order={fileOrder}
          onSave={setFileOrder}
          onClose={() => setShowContextOrder(false)}
        />
      )}

      {showTimerSettings && (
        <TimerSettingsDialog
          settings={timerSettings}
          onUpdate={updateTimerSettings}
          onReset={resetTimerSettings}
          disabled={timerPhase !== 'idle'}
          onClose={() => setShowTimerSettings(false)}
        />
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
                  ? t('recurring.notice.none')
                  : t('recurring.notice.added', {
                      count: added,
                      taskWord: t(added === 1 ? 'recurring.taskAddedOne' : 'recurring.taskAddedMany'),
                    }),
            }));
            void refresh(data.selectedDay, data.week);
          }}
        />
      )}

      {showTemplates && data && (
        <DayTemplatesDialog
          templates={data.dayTemplates}
          selectedDate={data.selectedDate}
          dayLabel={data.selectedDay}
          dayTaskCount={data.tasks.length}
          fileId={selectedFileId}
          onChanged={() => void refresh(data.selectedDay, data.week)}
          onApplied={(added) => {
            setRecurringNotice((prev) => ({
              n: (prev?.n ?? 0) + 1,
              text:
                added === 0
                  ? t('templates.notice.none')
                  : t('templates.notice.added', {
                      count: added,
                      word: t(added === 1 ? 'templates.taskAddedOne' : 'templates.taskAddedMany'),
                    }),
            }));
            void refresh(data.selectedDay, data.week);
          }}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {pendingSwitch && (
        <ConfirmDialog
          title={t('guard.title')}
          message={t('guard.body', { message: pendingSwitch.message })}
          confirmLabel={t('guard.confirm')}
          cancelLabel={t('guard.keepRunning')}
          destructive
          onConfirm={confirmPendingSwitch}
          onCancel={() => setPendingSwitch(null)}
        />
      )}

      {pendingBulkDelete && (
        <ConfirmDialog
          title={t('bulk.deleteTitle', { count: selectedIds.size })}
          message={t('bulk.deleteBody')}
          confirmLabel={t('common.delete')}
          destructive
          onConfirm={() => void runBulk('delete')}
          onCancel={() => setPendingBulkDelete(false)}
        />
      )}
    </div>
    </DragProvider>
  );
}
