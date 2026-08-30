import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { postSession } from '../api';
import { formatDurationLabel } from '../duration';
import { notifyPhaseChange } from '../notify';
import { playChime, unlockAudio } from '../sound';
import { clearActiveTimer, loadActiveTimer, saveActiveTimer } from '../timerStorage';
import { overrunElapsedHours, shouldWarnOverrun } from '../timerOverrun';
import { isLongBreakDue, type TimerSettings } from '../timerSettings';
import type { Session, Task, TimerMode, TimerPhase } from '../types';
import ProgressRing from './ProgressRing';

const MIN_LOGGABLE_MS = 30 * 1000; // ignora arranques accidentales de <30s

function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export type TimerHandle = {
  start: () => void;
  stop: () => void;
};

const Timer = forwardRef<
  TimerHandle,
  {
    task: Task | null;
    settings: TimerSettings;
    onSessionLogged: (taskId: string, session: Session) => void;
    onPhaseChange?: (phase: TimerPhase) => void;
    soundsEnabled: boolean;
    notificationsEnabled: boolean;
    /** Con `false`, solo el modo "Libre" y sin selector de modo. */
    pomodoroEnabled: boolean;
  }
>(function Timer(
  { task, settings, onSessionLogged, onPhaseChange, soundsEnabled, notificationsEnabled, pomodoroEnabled },
  ref
) {
  const [mode, setMode] = useState<TimerMode>(pomodoroEnabled ? 'pomodoro' : 'free');
  const [phase, setPhase] = useState<TimerPhase>('idle');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ciclo pomodoro → descanso largo.
  const [completedPomodoros, setCompletedPomodoros] = useState(0);
  const [breakIsLong, setBreakIsLong] = useState(false);

  const WORK_MS = settings.workMinutes * 60 * 1000;
  const BREAK_MS = (breakIsLong ? settings.longBreakMinutes : settings.shortBreakMinutes) * 60 * 1000;

  // Los callbacks del temporizador leen valores frescos sin re-suscribir efectos.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const completedRef = useRef(completedPomodoros);
  completedRef.current = completedPomodoros;
  // Última marca horaria del aviso de "timer olvidado" que el usuario ya
  // ignoró — se resetea al detener o cambiar de tarea.
  const [overrunAckHours, setOverrunAckHours] = useState(0);

  const taskRef = useRef(task);
  const restoredRef = useRef(false);

  // Restaura un timer en curso guardado en localStorage (refresh, tab
  // cerrada por accidente, celular que se bloqueó) apenas la tarea
  // correspondiente esté disponible. Solo se intenta una vez.
  useEffect(() => {
    if (restoredRef.current || !task) return;
    restoredRef.current = true;
    const persisted = loadActiveTimer();
    if (persisted && persisted.taskId === task.id) {
      setMode(pomodoroEnabled ? persisted.mode : 'free');
      setPhase(persisted.phase);
      setStartedAt(persisted.startedAt);
      setCompletedPomodoros(persisted.completedPomodoros ?? 0);
      setBreakIsLong(persisted.breakIsLong ?? false);
      setNow(Date.now());
    }
  }, [task]);

  useEffect(() => {
    const prev = taskRef.current;
    taskRef.current = task;
    if (phase !== 'idle' && prev?.id !== task?.id) {
      setPhase('idle');
      setStartedAt(null);
    }
  }, [task, phase]);

  // Si se apaga el Pomodoro mientras el timer está quieto, pasar a "Libre".
  // Un pomodoro en curso se respeta hasta que termine.
  useEffect(() => {
    if (!pomodoroEnabled && phase === 'idle' && mode !== 'free') setMode('free');
  }, [pomodoroEnabled, phase, mode]);

  useEffect(() => {
    if (phase === 'idle') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [phase]);

  // Persistir/limpiar el timer activo en localStorage.
  useEffect(() => {
    if (task && startedAt != null && (phase === 'work' || phase === 'break')) {
      saveActiveTimer({
        taskId: task.id,
        taskName: task.name,
        mode,
        phase,
        startedAt,
        date: task.date ?? '',
        completedPomodoros,
        breakIsLong,
      });
    } else if (phase === 'idle') {
      clearActiveTimer();
    }
  }, [task, phase, startedAt, mode, completedPomodoros, breakIsLong]);

  // Título de la pestaña con el countdown, para ver el progreso sin cambiar de tab.
  useEffect(() => {
    if (phase === 'idle') {
      document.title = 'pomotion';
      return;
    }
    const elapsed = startedAt != null ? now - startedAt : 0;
    const remaining = mode === 'pomodoro' ? (phase === 'work' ? WORK_MS : BREAK_MS) - elapsed : elapsed;
    const label = mode === 'pomodoro' ? formatClock(remaining) : formatClock(elapsed);
    const icon = phase === 'break' ? '☕' : '⏱';
    document.title = `${icon} ${label} · pomotion`;
    return () => {
      document.title = 'pomotion';
    };
  }, [phase, now, startedAt, mode]);

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);

  useEffect(() => {
    if (phase === 'idle') setOverrunAckHours(0);
  }, [phase]);

  async function finishWork(natural: boolean) {
    const currentTask = taskRef.current;
    if (!currentTask || startedAt == null) {
      setPhase('idle');
      setStartedAt(null);
      return;
    }
    const endedAt = Date.now();
    const elapsedMs = endedAt - startedAt;

    if (elapsedMs < MIN_LOGGABLE_MS) {
      setPhase('idle');
      setStartedAt(null);
      return;
    }

    const durationSeconds = Math.max(1, Math.round(elapsedMs / 1000));
    setPosting(true);
    setError(null);
    try {
      const res = await postSession({
        task_id: currentTask.id,
        duration_seconds: durationSeconds,
        start_time: new Date(startedAt).toISOString(),
        end_time: new Date(endedAt).toISOString(),
      });
      onSessionLogged(currentTask.id, res.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la sesión');
    } finally {
      setPosting(false);
    }

    if (mode === 'pomodoro' && natural) {
      if (soundsEnabled) playChime('work-done');
      if (notificationsEnabled) notifyPhaseChange('work-done');
      const done = completedRef.current + 1;
      const long = isLongBreakDue(done, settingsRef.current.longBreakEvery);
      setBreakIsLong(long);
      setCompletedPomodoros(long ? 0 : done);
      setPhase('break');
      setStartedAt(Date.now());
    } else {
      setPhase('idle');
      setStartedAt(null);
    }
  }

  // Avance automático de fases en modo pomodoro.
  useEffect(() => {
    if (phase === 'idle' || startedAt == null) return;
    const elapsed = now - startedAt;
    if (mode === 'pomodoro' && phase === 'work' && elapsed >= WORK_MS) {
      void finishWork(true);
    } else if (mode === 'pomodoro' && phase === 'break' && elapsed >= BREAK_MS) {
      if (soundsEnabled) playChime('break-done');
      if (notificationsEnabled) notifyPhaseChange('break-done');
      if (settingsRef.current.autoStartNext && taskRef.current) {
        setBreakIsLong(false);
        setOverrunAckHours(0);
        setPhase('work');
        setStartedAt(Date.now());
      } else {
        setPhase('idle');
        setStartedAt(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, phase, mode, startedAt]);

  function start() {
    if (!task || phase !== 'idle') return;
    unlockAudio(); // gesto real del usuario: deja el audio listo para el chime automático de más tarde
    setError(null);
    setOverrunAckHours(0);
    setCompletedPomodoros(0);
    setBreakIsLong(false);
    setPhase('work');
    setStartedAt(Date.now());
    setNow(Date.now());
  }

  function stop() {
    if (phase === 'work') {
      void finishWork(false);
    } else if (phase === 'break') {
      setPhase('idle');
      setStartedAt(null);
    }
  }

  useImperativeHandle(ref, () => ({ start, stop }));

  const elapsed = startedAt != null ? now - startedAt : 0;
  const totalMs = mode === 'pomodoro' ? (phase === 'break' ? BREAK_MS : WORK_MS) : 0;
  const remainingMs = totalMs - elapsed;
  const displayMs = mode === 'pomodoro' ? (phase === 'idle' ? WORK_MS : remainingMs) : elapsed;
  const ringProgress = mode === 'pomodoro' ? (phase === 'idle' ? 1 : Math.max(0, remainingMs / totalMs)) : 1;

  const elapsedHours = overrunElapsedHours(elapsed);
  const showOverrunWarning = shouldWarnOverrun({
    running: phase !== 'idle',
    posting,
    elapsedMs: elapsed,
    ackHours: overrunAckHours,
  });

  return (
    <div className="timer">
      {pomodoroEnabled && (
        <div className="segmented-control" role="tablist" aria-label="Modo de timer">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'pomodoro'}
            className={mode === 'pomodoro' ? 'segment active' : 'segment'}
            disabled={phase !== 'idle'}
            onClick={() => setMode('pomodoro')}
          >
            Pomodoro
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'free'}
            className={mode === 'free' ? 'segment active' : 'segment'}
            disabled={phase !== 'idle'}
            onClick={() => setMode('free')}
          >
            Libre
          </button>
        </div>
      )}

      <div className="timer-dial">
        <ProgressRing progress={ringProgress} pulse={mode === 'free' && phase === 'work'} />
        <div className={`timer-clock phase-${phase}`}>{formatClock(displayMs)}</div>
      </div>

      <p className="timer-phase-label">
        {phase === 'idle' && (task ? 'Listo para iniciar' : 'Selecciona una tarea')}
        {phase === 'work' && (task ? task.name : 'Trabajando')}
        {phase === 'break' && (breakIsLong ? 'Descanso largo' : 'Descanso')}
      </p>

      {showOverrunWarning && (
        <div className="warning banner timer-overrun" role="alert">
          <span>
            Este timer lleva <strong>{formatDurationLabel(Math.floor(elapsed / 1000))}</strong>{' '}
            corriendo. ¿Seguís?
          </span>
          <span className="timer-overrun-actions">
            <button type="button" className="btn btn-destructive btn-small" onClick={stop}>
              Detener
            </button>
            <button
              type="button"
              className="banner-dismiss"
              onClick={() => setOverrunAckHours(elapsedHours)}
              aria-label="Ignorar aviso"
              title="Ignorar"
            >
              ×
            </button>
          </span>
        </div>
      )}

      <div className="timer-actions">
        {phase === 'idle' && (
          <button type="button" className="btn btn-filled btn-large" onClick={start} disabled={!task}>
            Iniciar
          </button>
        )}
        {phase === 'work' && (
          <button type="button" className="btn btn-destructive btn-large" onClick={stop} disabled={posting}>
            {posting ? 'Guardando…' : 'Detener'}
          </button>
        )}
        {phase === 'break' && (
          <button type="button" className="btn btn-tinted btn-large" onClick={stop}>
            Saltar descanso
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
});

export default Timer;
