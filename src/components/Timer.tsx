import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { postSession } from '../api';
import { playChime, unlockAudio } from '../sound';
import { clearActiveTimer, loadActiveTimer, saveActiveTimer } from '../timerStorage';
import type { Session, Task, TimerMode, TimerPhase } from '../types';
import ProgressRing from './ProgressRing';

const WORK_MS = 25 * 60 * 1000;
const BREAK_MS = 5 * 60 * 1000;
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
    onSessionLogged: (blockId: string, session: Session) => void;
    onPhaseChange?: (phase: TimerPhase) => void;
    soundsEnabled: boolean;
  }
>(function Timer({ task, onSessionLogged, onPhaseChange, soundsEnabled }, ref) {
  const [mode, setMode] = useState<TimerMode>('pomodoro');
  const [phase, setPhase] = useState<TimerPhase>('idle');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taskRef = useRef(task);
  const restoredRef = useRef(false);

  // Restaura un timer en curso guardado en localStorage (refresh, tab
  // cerrada por accidente, celular que se bloqueó) apenas la tarea
  // correspondiente esté disponible. Solo se intenta una vez.
  useEffect(() => {
    if (restoredRef.current || !task) return;
    restoredRef.current = true;
    const persisted = loadActiveTimer();
    if (persisted && persisted.taskBlockId === task.blockId) {
      setMode(persisted.mode);
      setPhase(persisted.phase);
      setStartedAt(persisted.startedAt);
      setNow(Date.now());
    }
  }, [task]);

  useEffect(() => {
    const prev = taskRef.current;
    taskRef.current = task;
    if (phase !== 'idle' && prev?.blockId !== task?.blockId) {
      setPhase('idle');
      setStartedAt(null);
    }
  }, [task, phase]);

  useEffect(() => {
    if (phase === 'idle') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [phase]);

  // Persistir/limpiar el timer activo en localStorage.
  useEffect(() => {
    if (task && startedAt != null && (phase === 'work' || phase === 'break')) {
      saveActiveTimer({ taskBlockId: task.blockId, taskText: task.text, mode, phase, startedAt, day: task.day });
    } else if (phase === 'idle') {
      clearActiveTimer();
    }
  }, [task, phase, startedAt, mode]);

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

    const durationMinutes = Math.max(1, Math.round(elapsedMs / 60000));
    setPosting(true);
    setError(null);
    try {
      const res = await postSession({
        block_id: currentTask.blockId,
        duration_minutes: durationMinutes,
        start_time: new Date(startedAt).toISOString(),
        end_time: new Date(endedAt).toISOString(),
      });
      onSessionLogged(currentTask.blockId, {
        blockId: res.session.blockId,
        durationMinutes: res.session.durationMinutes,
        start: res.session.start,
        end: res.session.end,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la sesión en Notion');
    } finally {
      setPosting(false);
    }

    if (mode === 'pomodoro' && natural) {
      if (soundsEnabled) playChime('work-done');
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
      setPhase('idle');
      setStartedAt(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, phase, mode, startedAt]);

  function start() {
    if (!task || phase !== 'idle') return;
    unlockAudio(); // gesto real del usuario: deja el audio listo para el chime automático de más tarde
    setError(null);
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

  return (
    <div className="timer">
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

      <div className="timer-dial">
        <ProgressRing progress={ringProgress} pulse={mode === 'free' && phase === 'work'} />
        <div className={`timer-clock phase-${phase}`}>{formatClock(displayMs)}</div>
      </div>

      <p className="timer-phase-label">
        {phase === 'idle' && (task ? 'Listo para iniciar' : 'Selecciona una tarea')}
        {phase === 'work' && (task ? task.text : 'Trabajando')}
        {phase === 'break' && 'Descanso'}
      </p>

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
