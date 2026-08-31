import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { updateTaskFields, UnauthorizedError } from '../api';
import { nowAsHHMM } from '../duration';
import { shortDate } from '../taskMeta';
import {
  clampBlockDuration,
  clampBlockStart,
  layoutColumns,
  MINUTES_PER_DAY,
  minutesToTime,
  plannedRange,
  sessionRange,
  snapMinutes,
  timeToMinutes,
  type TimeRange,
} from '../timeline';
import type { Tag, Task } from '../types';
import { useLang, useT } from '../i18n';
import TaskDetails from './TaskDetails';

const HOUR_PX = 52;
const PX_PER_MIN = HOUR_PX / 60;
const MIN_BLOCK_PX = 20;
const MOUSE_THRESHOLD = 5; // px de movimiento para arrancar el drag con mouse
const TOUCH_HOLD_MS = 240; // mantener presionado para arrancar con el dedo
const TOUCH_SLOP = 10; // si el dedo se mueve más que esto antes del hold, es scroll

type LivePreview = { taskId: string; start: number; duration: number };
type ScheduleGhost = { taskId: string; name: string; x: number; y: number; overLane: boolean };

type MoveGesture = {
  kind: 'move';
  taskId: string;
  pointerId: number;
  isTouch: boolean;
  startY: number;
  dragging: boolean;
  holdTimer: number | null;
  originStart: number;
};
type ResizeGesture = {
  kind: 'resize';
  taskId: string;
  pointerId: number;
  startY: number;
  blockStart: number;
  originDuration: number;
};
type ScheduleGesture = {
  kind: 'schedule';
  taskId: string;
  taskName: string;
  pointerId: number;
  isTouch: boolean;
  startX: number;
  startY: number;
  dragging: boolean;
  holdTimer: number | null;
};
type Gesture = MoveGesture | ResizeGesture | ScheduleGesture;

type Deps = {
  laneRef: { current: HTMLDivElement | null };
  getTask: () => (id: string) => Task | undefined;
  commitStart: () => (id: string, startMin: number) => void;
  commitDuration: () => (id: string, durationMin: number) => void;
  commitSchedule: () => (id: string, startMin: number) => void;
  setLive: (v: LivePreview | null) => void;
  setGhost: (v: ScheduleGhost | null) => void;
  setDraggingId: (id: string | null) => void;
};

/**
 * Controlador de arrastre por pointer events, hecho a mano (mismo enfoque
 * que `src/drag/DragProvider.tsx`, adaptado a tres gestos en vez de uno):
 * mover un bloque (cambia la hora), redimensionar desde el borde inferior
 * (cambia la duración), y arrastrar una tarea sin horario desde la cola
 * hasta el timeline para agendarla. Umbral de movimiento con mouse /
 * mantener presionado con el dedo, así el tap para abrir el detalle y el
 * scroll normal del timeline siguen funcionando.
 */
function makeTimelineController(deps: Deps) {
  let g: Gesture | null = null;
  let touchBlocked = false;

  function blockTouchScroll(block: boolean) {
    if (block === touchBlocked) return;
    touchBlocked = block;
    if (block) document.addEventListener('touchmove', preventTouchScroll, { passive: false });
    else document.removeEventListener('touchmove', preventTouchScroll);
  }

  function preventTouchScroll(e: TouchEvent) {
    if (g) e.preventDefault();
  }

  function teardown() {
    const s = g;
    g = null;
    if (s && (s.kind === 'move' || s.kind === 'schedule') && s.holdTimer != null) {
      window.clearTimeout(s.holdTimer);
    }
    blockTouchScroll(false);
    deps.setDraggingId(null);
    deps.setLive(null);
    deps.setGhost(null);
  }

  function swallowNextClick() {
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
  }

  function startDragging(gesture: MoveGesture | ScheduleGesture) {
    gesture.dragging = true;
    if (gesture.holdTimer != null) {
      window.clearTimeout(gesture.holdTimer);
      gesture.holdTimer = null;
    }
    blockTouchScroll(true);
    deps.setDraggingId(gesture.taskId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!g || e.pointerId !== g.pointerId) return;

    if (g.kind === 'resize') {
      e.preventDefault();
      const deltaMin = (e.clientY - g.startY) / PX_PER_MIN;
      const duration = clampBlockDuration(g.blockStart, snapMinutes(g.originDuration + deltaMin));
      deps.setLive({ taskId: g.taskId, start: g.blockStart, duration });
      return;
    }

    if (g.kind === 'move') {
      if (!g.dragging) {
        const dist = Math.abs(e.clientY - g.startY);
        if (g.isTouch) {
          if (dist > TOUCH_SLOP) teardown();
        } else if (dist > MOUSE_THRESHOLD) {
          startDragging(g);
        }
        return;
      }
      e.preventDefault();
      const deltaMin = (e.clientY - g.startY) / PX_PER_MIN;
      const start = clampBlockStart(snapMinutes(g.originStart + deltaMin));
      const task = deps.getTask()(g.taskId);
      const range = task ? plannedRange(minutesToTime(start), task.plannedMinutes, task.estimateMinutes) : null;
      deps.setLive({ taskId: g.taskId, start, duration: range ? range.end - range.start : 0 });
      return;
    }

    // schedule
    if (!g.dragging) {
      const dist = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);
      if (g.isTouch) {
        if (dist > TOUCH_SLOP) teardown();
      } else if (dist > MOUSE_THRESHOLD) {
        startDragging(g);
      }
      return;
    }
    e.preventDefault();
    const rect = deps.laneRef.current?.getBoundingClientRect() ?? null;
    const overLane =
      !!rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    deps.setGhost({ taskId: g.taskId, name: g.taskName, x: e.clientX, y: e.clientY, overLane });
  }

  function onPointerUp(e: PointerEvent) {
    if (!g || e.pointerId !== g.pointerId) return;
    const finished = g;
    g = null;
    blockTouchScroll(false);
    deps.setDraggingId(null);

    if (finished.kind === 'resize') {
      deps.setLive(null);
      swallowNextClick(); // el mouseup sobre el handle no debe "clickear" el bloque padre
      const deltaMin = (e.clientY - finished.startY) / PX_PER_MIN;
      const duration = clampBlockDuration(finished.blockStart, snapMinutes(finished.originDuration + deltaMin));
      if (duration !== finished.originDuration) deps.commitDuration()(finished.taskId, duration);
      return;
    }

    if (finished.kind === 'move') {
      if (finished.holdTimer != null) window.clearTimeout(finished.holdTimer);
      deps.setLive(null);
      if (!finished.dragging) return; // fue un tap: el click nativo abre el detalle
      swallowNextClick();
      const deltaMin = (e.clientY - finished.startY) / PX_PER_MIN;
      const start = clampBlockStart(snapMinutes(finished.originStart + deltaMin));
      if (start !== finished.originStart) deps.commitStart()(finished.taskId, start);
      return;
    }

    // schedule
    if (finished.holdTimer != null) window.clearTimeout(finished.holdTimer);
    deps.setGhost(null);
    if (!finished.dragging) return;
    swallowNextClick();
    const rect = deps.laneRef.current?.getBoundingClientRect() ?? null;
    if (!rect) return;
    const overLane = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!overLane) return;
    const minute = clampBlockStart(snapMinutes((e.clientY - rect.top) / PX_PER_MIN));
    deps.commitSchedule()(finished.taskId, minute);
  }

  function onPointerCancel(e: PointerEvent) {
    if (!g || e.pointerId !== g.pointerId) return;
    teardown();
  }

  function onKeyDown(e: KeyboardEvent) {
    // Captura: si hay un gesto en curso lo cancela y NO deja que el Escape
    // siga de largo hasta el listener del diálogo (que cerraría la agenda).
    if (e.key !== 'Escape' || !g) return;
    e.preventDefault();
    e.stopPropagation();
    teardown();
  }

  function beginMove(e: ReactPointerEvent, taskId: string, originStart: number) {
    if (g) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const isTouch = e.pointerType !== 'mouse';
    const gesture: MoveGesture = {
      kind: 'move',
      taskId,
      pointerId: e.pointerId,
      isTouch,
      startY: e.clientY,
      dragging: false,
      holdTimer: null,
      originStart,
    };
    g = gesture;
    if (isTouch) gesture.holdTimer = window.setTimeout(() => startDragging(gesture), TOUCH_HOLD_MS);
  }

  function beginResize(e: ReactPointerEvent, taskId: string, blockStart: number, originDuration: number) {
    if (g) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    g = { kind: 'resize', taskId, pointerId: e.pointerId, startY: e.clientY, blockStart, originDuration };
    blockTouchScroll(true);
    deps.setDraggingId(taskId);
  }

  function beginSchedule(e: ReactPointerEvent, taskId: string, taskName: string) {
    if (g) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const isTouch = e.pointerType !== 'mouse';
    const gesture: ScheduleGesture = {
      kind: 'schedule',
      taskId,
      taskName,
      pointerId: e.pointerId,
      isTouch,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      holdTimer: null,
    };
    g = gesture;
    if (isTouch) gesture.holdTimer = window.setTimeout(() => startDragging(gesture), TOUCH_HOLD_MS);
  }

  function mount() {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown, true);
  }
  function unmount() {
    teardown();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('keydown', onKeyDown, true);
  }

  return { beginMove, beginResize, beginSchedule, mount, unmount };
}

type SessionBar = { id: string; taskId: string; taskName: string; range: TimeRange };

export default function DayTimeline({
  tasks,
  selectedDate,
  today,
  allTags,
  onManageTags,
  onTaskUpdated,
  onClose,
  onPreviousDay,
  onNextDay,
  onToday,
  loading,
}: {
  tasks: Task[];
  selectedDate: string;
  today: string;
  allTags: Tag[];
  onManageTags: () => void;
  onTaskUpdated: (id: string, patch: Partial<Task>) => void;
  onClose: () => void;
  /** Ir al día anterior/siguiente sin cerrar la Agenda. */
  onPreviousDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
  loading?: boolean;
}) {
  const t = useT();
  const { lang } = useLang();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [live, setLive] = useState<LivePreview | null>(null);
  const [ghost, setGhost] = useState<ScheduleGhost | null>(null);
  const [error, setError] = useState<string | null>(null);

  const laneRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tasksRef = useRef(tasks);
  const onTaskUpdatedRef = useRef(onTaskUpdated);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    onTaskUpdatedRef.current = onTaskUpdated;
  }, [onTaskUpdated]);

  async function commitStart(taskId: string, startMin: number) {
    const plannedStart = minutesToTime(startMin);
    try {
      await updateTaskFields(taskId, { plannedStart });
      onTaskUpdatedRef.current(taskId, { plannedStart });
    } catch (err) {
      setError(
        err instanceof UnauthorizedError
          ? t('common.sessionExpired')
          : err instanceof Error
            ? err.message
            : t('timeline.saveError')
      );
    }
  }

  async function commitDuration(taskId: string, durationMin: number) {
    try {
      await updateTaskFields(taskId, { plannedMinutes: durationMin });
      onTaskUpdatedRef.current(taskId, { plannedMinutes: durationMin });
    } catch (err) {
      setError(
        err instanceof UnauthorizedError
          ? t('common.sessionExpired')
          : err instanceof Error
            ? err.message
            : t('timeline.saveError')
      );
    }
  }

  async function commitSchedule(taskId: string, startMin: number) {
    const plannedStart = minutesToTime(startMin);
    try {
      await updateTaskFields(taskId, { plannedStart });
      onTaskUpdatedRef.current(taskId, { plannedStart });
    } catch (err) {
      setError(
        err instanceof UnauthorizedError
          ? t('common.sessionExpired')
          : err instanceof Error
            ? err.message
            : t('timeline.saveError')
      );
    }
  }

  const ctrlRef = useRef<ReturnType<typeof makeTimelineController> | null>(null);
  if (!ctrlRef.current) {
    ctrlRef.current = makeTimelineController({
      laneRef,
      getTask: () => (id) => tasksRef.current.find((x) => x.id === id),
      commitStart: () => commitStart,
      commitDuration: () => commitDuration,
      commitSchedule: () => commitSchedule,
      setLive,
      setGhost,
      setDraggingId,
    });
  }
  const ctrl = ctrlRef.current;

  useEffect(() => {
    ctrl.mount();
    return () => ctrl.unmount();
  }, [ctrl]);

  // Escape cierra el diálogo — pero el controller ya lo intercepta (y lo
  // frena con stopPropagation) mientras hay un gesto en curso.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const scheduled = useMemo(() => tasks.filter((task) => task.plannedStart != null), [tasks]);
  const unscheduled = useMemo(() => tasks.filter((task) => task.plannedStart == null), [tasks]);

  const ranges = useMemo(() => {
    const map = new Map<string, TimeRange>();
    for (const task of scheduled) {
      if (live && live.taskId === task.id) {
        map.set(task.id, { start: live.start, end: Math.min(MINUTES_PER_DAY, live.start + live.duration) });
      } else {
        map.set(task.id, plannedRange(task.plannedStart!, task.plannedMinutes, task.estimateMinutes));
      }
    }
    return map;
  }, [scheduled, live]);

  const layout = useMemo(
    () => layoutColumns(scheduled.map((task) => ({ id: task.id, ...ranges.get(task.id)! }))),
    [scheduled, ranges]
  );

  const sessionBars = useMemo<SessionBar[]>(() => {
    const bars: SessionBar[] = [];
    for (const task of tasks) {
      for (const s of task.sessions) {
        bars.push({ id: s.id, taskId: task.id, taskName: task.name, range: sessionRange(s.start, s.end) });
      }
    }
    return bars;
  }, [tasks]);
  const sessionLayout = useMemo(
    () => layoutColumns(sessionBars.map((b) => ({ id: b.id, ...b.range }))),
    [sessionBars]
  );

  // Al abrir: mostrar la hora actual (o la primera tarea agendada, si es
  // más temprano) con un margen arriba, en vez del inicio del día.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isToday = selectedDate === today;
    const defaultStart = isToday ? timeToMinutes(nowAsHHMM()) : 7 * 60;
    const earliest = scheduled.reduce(
      (min, task) => Math.min(min, ranges.get(task.id)?.start ?? min),
      defaultStart
    );
    const target = Math.max(0, Math.min(defaultStart, earliest) - 60);
    el.scrollTop = target * PX_PER_MIN;
    // Solo al montar: es la posición inicial de scroll, no algo a re-sincronizar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isToday = selectedDate === today;
  const nowMin = timeToMinutes(nowAsHHMM());
  const expandedTask = expandedId ? (tasks.find((task) => task.id === expandedId) ?? null) : null;

  const hours = Array.from({ length: 25 }, (_, h) => h);
  const gridBackground = {
    backgroundImage: `repeating-linear-gradient(to bottom, var(--color-separator) 0, var(--color-separator) 1px, transparent 1px, transparent ${HOUR_PX}px)`,
  };

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--timeline"
        role="dialog"
        aria-modal="true"
        aria-labelledby="timeline-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="timeline-header">
          <h2 id="timeline-title">{t('timeline.title')}</h2>
          <div className="timeline-day-nav">
            <button
              type="button"
              className="btn btn-icon"
              onClick={onPreviousDay}
              disabled={loading}
              aria-label={t('day.prevDay')}
              title={t('day.prevDay')}
            >
              ‹
            </button>
            <span className="timeline-day-label">{shortDate(selectedDate, lang)}</span>
            <button
              type="button"
              className="btn btn-icon"
              onClick={onNextDay}
              disabled={loading}
              aria-label={t('day.nextDay')}
              title={t('day.nextDay')}
            >
              ›
            </button>
            {selectedDate !== today && (
              <button
                type="button"
                className="btn btn-tinted btn-small"
                onClick={onToday}
                disabled={loading}
              >
                {t('day.today')}
              </button>
            )}
          </div>
        </div>

        <div className="timeline-content">
          <div className="timeline-legend">
            <span><i className="timeline-swatch timeline-swatch--planned" /> {t('timeline.planned')}</span>
            <span><i className="timeline-swatch timeline-swatch--actual" /> {t('timeline.actual')}</span>
          </div>

          {unscheduled.length > 0 && (
            <div className="timeline-unscheduled">
              <span className="timeline-unscheduled-label">{t('timeline.unscheduled')}</span>
              <div className="timeline-unscheduled-list">
                {unscheduled.map((task) => (
                  <button
                    type="button"
                    key={task.id}
                    className={draggingId === task.id ? 'timeline-chip is-dragging' : 'timeline-chip'}
                    data-priority={task.priority ?? undefined}
                    onPointerDown={(e) => ctrl.beginSchedule(e, task.id, task.name)}
                    onClick={() => setExpandedId((cur) => (cur === task.id ? null : task.id))}
                  >
                    {task.name || t('taskList.noText')}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="timeline-scroll" ref={scrollRef}>
            <div className="timeline-body" style={{ height: MINUTES_PER_DAY * PX_PER_MIN }}>
              <div className="timeline-hours">
                {hours.map((h) => (
                  <span key={h} className="timeline-hour-label" style={{ top: h * HOUR_PX }}>
                    {String(h).padStart(2, '0')}:00
                  </span>
                ))}
              </div>
              <div className="timeline-lanes" style={gridBackground}>
                {isToday && nowMin < MINUTES_PER_DAY && (
                  <div className="timeline-now-line" style={{ top: nowMin * PX_PER_MIN }}>
                    <span className="timeline-now-dot" />
                  </div>
                )}
                <div
                  className={ghost?.overLane ? 'timeline-lane timeline-lane--planned is-drop-hot' : 'timeline-lane timeline-lane--planned'}
                  ref={laneRef}
                >
                  {scheduled.map((task) => {
                    const range = ranges.get(task.id)!;
                    const col = layout.get(task.id) ?? { col: 0, cols: 1 };
                    const widthPct = 100 / col.cols;
                    return (
                      <div
                        key={task.id}
                        className={[
                          'timeline-block',
                          expandedId === task.id ? 'is-expanded' : '',
                          draggingId === task.id ? 'is-dragging' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        data-priority={task.priority ?? undefined}
                        style={{
                          top: range.start * PX_PER_MIN,
                          height: Math.max((range.end - range.start) * PX_PER_MIN, MIN_BLOCK_PX),
                          left: `calc(${col.col * widthPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                        }}
                        onPointerDown={(e) => ctrl.beginMove(e, task.id, timeToMinutes(task.plannedStart!))}
                        onClick={() => setExpandedId((cur) => (cur === task.id ? null : task.id))}
                        title={task.name || t('taskList.noText')}
                      >
                        <span className="timeline-block-time">
                          {minutesToTime(range.start)}–{minutesToTime(range.end)}
                        </span>
                        <span className="timeline-block-name">{task.name || t('taskList.noText')}</span>
                        <span
                          className="timeline-resize-handle"
                          onPointerDown={(e) => {
                            e.stopPropagation(); // no dispares el "mover" del bloque padre
                            ctrl.beginResize(e, task.id, range.start, range.end - range.start);
                          }}
                          aria-label={t('timeline.resizeHandle')}
                          title={t('timeline.resizeHandle')}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="timeline-lane timeline-lane--actual">
                  {sessionBars.map((bar) => {
                    const col = sessionLayout.get(bar.id) ?? { col: 0, cols: 1 };
                    const widthPct = 100 / col.cols;
                    return (
                      <div
                        key={bar.id}
                        className="timeline-session-bar"
                        style={{
                          top: bar.range.start * PX_PER_MIN,
                          height: Math.max((bar.range.end - bar.range.start) * PX_PER_MIN, MIN_BLOCK_PX * 0.6),
                          left: `calc(${col.col * widthPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                        }}
                        title={`${bar.taskName || t('taskList.noText')} (${minutesToTime(bar.range.start)}–${minutesToTime(bar.range.end)})`}
                      >
                        {bar.taskName}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {expandedTask && (
            <div className="timeline-details">
              <div className="timeline-details-header">
                <strong>{expandedTask.name || t('taskList.noText')}</strong>
                <button
                  type="button"
                  className="btn btn-icon"
                  onClick={() => setExpandedId(null)}
                  aria-label={t('common.close')}
                  title={t('common.close')}
                >
                  ×
                </button>
              </div>
              <TaskDetails
                task={expandedTask}
                allTags={allTags}
                onChange={(patch) => onTaskUpdated(expandedTask.id, patch)}
                onManageTags={onManageTags}
              />
            </div>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn btn-plain" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>

      {ghost &&
        createPortal(
          <div
            className={ghost.overLane ? 'timeline-ghost is-over' : 'timeline-ghost'}
            style={{ transform: `translate(${ghost.x + 12}px, ${ghost.y + 14}px)` }}
          >
            {ghost.name || t('taskList.noText')}
          </div>,
          document.body
        )}
    </div>
  );
}
