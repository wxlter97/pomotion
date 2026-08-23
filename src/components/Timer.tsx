import { useEffect, useRef, useState } from 'react';
import { postSession } from '../api';
import type { Session, Task, TimerMode } from '../types';

const WORK_MS = 25 * 60 * 1000;
const BREAK_MS = 5 * 60 * 1000;
const MIN_LOGGABLE_MS = 30 * 1000; // ignora arranques accidentales de <30s

type Phase = 'idle' | 'work' | 'break';

function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function Timer({
  task,
  onSessionLogged,
}: {
  task: Task | null;
  onSessionLogged: (blockId: string, session: Session) => void;
}) {
  const [mode, setMode] = useState<TimerMode>('pomodoro');
  const [phase, setPhase] = useState<Phase>('idle');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const taskRef = useRef(task);
  useEffect(() => {
    const prev = taskRef.current;
    taskRef.current = task;
    if (phase !== 'idle' && prev?.blockId !== task?.blockId) {
      setPhase('idle');
      setStartedAt(null);
      setInfo('Timer cancelado: cambiaste de tarea sin guardar la sesión en curso.');
    }
  }, [task, phase]);

  useEffect(() => {
    if (phase === 'idle') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
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

    const durationMinutes = Math.max(1, Math.round(elapsedMs / 60000));
    setPosting(true);
    setError(null);
    setInfo(null);
    try {
      const res = await postSession({
        block_id: currentTask.blockId,
        duration_minutes: durationMinutes,
        start_time: new Date(startedAt).toISOString(),
        end_time: new Date(endedAt).toISOString(),
      });
      onSessionLogged(currentTask.blockId, res.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la sesión en Notion');
    } finally {
      setPosting(false);
    }

    if (mode === 'pomodoro' && natural) {
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
      setPhase('idle');
      setStartedAt(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, phase, mode, startedAt]);

  function start() {
    if (!task || phase !== 'idle') return;
    setError(null);
    setInfo(null);
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

  const elapsed = startedAt != null ? now - startedAt : 0;
  const displayMs =
    mode === 'pomodoro'
      ? phase === 'work'
        ? WORK_MS - elapsed
        : phase === 'break'
          ? BREAK_MS - elapsed
          : WORK_MS
      : elapsed;

  return (
    <div className="timer">
      <div className="timer-mode">
        <button
          type="button"
          className={mode === 'pomodoro' ? 'mode-tab active' : 'mode-tab'}
          disabled={phase !== 'idle'}
          onClick={() => setMode('pomodoro')}
        >
          Pomodoro
        </button>
        <button
          type="button"
          className={mode === 'free' ? 'mode-tab active' : 'mode-tab'}
          disabled={phase !== 'idle'}
          onClick={() => setMode('free')}
        >
          Libre
        </button>
      </div>

      <div className={`timer-clock phase-${phase}`}>{formatClock(displayMs)}</div>
      <p className="timer-phase-label">
        {phase === 'idle' && (task ? 'Listo para iniciar' : 'Selecciona una tarea')}
        {phase === 'work' && (task ? `Trabajando en: ${task.text}` : 'Trabajando')}
        {phase === 'break' && 'Descanso'}
      </p>

      <div className="timer-actions">
        {phase === 'idle' && (
          <button type="button" onClick={start} disabled={!task}>
            Iniciar
          </button>
        )}
        {phase === 'work' && (
          <button type="button" className="danger" onClick={stop} disabled={posting}>
            {posting ? 'Guardando…' : 'Detener'}
          </button>
        )}
        {phase === 'break' && (
          <button type="button" onClick={stop}>
            Saltar descanso
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {info && <p className="muted">{info}</p>}
    </div>
  );
}
