import { useEffect, useRef, useState } from 'react';
import { getTasks } from '../api';
import type { DayContainer } from '../types';

export type MoveTarget = {
  containerId: string;
  afterBlockId: string;
  /** Etiqueta legible del destino, para el aviso de confirmación / errores. */
  destLabel: string;
};

/** Días de una semana a los que se puede mover una tarea: todos menos el
 *  día en que está ahora (si se pasa `excludeDay`). Puro, testeable. */
export function movableTargets(dayContainers: DayContainer[], excludeDay: string | null): DayContainer[] {
  return dayContainers.filter((d) => d.day !== excludeDay);
}

type OtherWeek = { label: string; days: DayContainer[] };

export default function MoveTaskMenu({
  currentDay,
  dayContainers,
  previousWeekLabel,
  nextWeekLabel,
  fileId,
  disabled,
  onMove,
}: {
  currentDay: string | null;
  dayContainers: DayContainer[];
  previousWeekLabel: string | null;
  nextWeekLabel: string | null;
  fileId: string | null;
  disabled: boolean;
  onMove: (target: MoveTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const [otherWeek, setOtherWeek] = useState<OtherWeek | null>(null);
  const [loadingWeek, setLoadingWeek] = useState<string | null>(null);
  const [weekError, setWeekError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setOtherWeek(null);
    setLoadingWeek(null);
    setWeekError(null);
  }

  async function loadWeek(label: string) {
    setLoadingWeek(label);
    setWeekError(null);
    try {
      const res = await getTasks(undefined, label, fileId ?? undefined);
      setOtherWeek({ label, days: res.dayContainers });
    } catch (err) {
      setWeekError(err instanceof Error ? err.message : 'No se pudo cargar esa semana');
    } finally {
      setLoadingWeek(null);
    }
  }

  function pick(day: DayContainer, weekLabel?: string) {
    onMove({
      containerId: day.containerId,
      afterBlockId: day.headingBlockId,
      destLabel: weekLabel ? `${day.day} · ${weekLabel}` : day.day,
    });
    close();
  }

  const sameWeekTargets = movableTargets(dayContainers, currentDay);

  return (
    <div className="move-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="task-move"
        onClick={() => (open ? close() : setOpen(true))}
        disabled={disabled}
        aria-label="Mover a otro día"
        title="Mover a otro día"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ↦
      </button>

      {open && (
        <div className="move-menu" role="menu">
          {otherWeek ? (
            <>
              <button type="button" className="move-menu-item move-menu-back" onClick={() => setOtherWeek(null)}>
                ‹ Esta semana
              </button>
              <div className="move-menu-heading">{otherWeek.label}</div>
              {otherWeek.days.length === 0 ? (
                <div className="move-menu-empty">Esa semana no tiene días</div>
              ) : (
                otherWeek.days.map((d) => (
                  <button
                    key={d.headingBlockId}
                    type="button"
                    className="move-menu-item"
                    role="menuitem"
                    onClick={() => pick(d, otherWeek.label)}
                  >
                    {d.day}
                  </button>
                ))
              )}
            </>
          ) : (
            <>
              <div className="move-menu-heading">Mover a…</div>
              {sameWeekTargets.length === 0 && !previousWeekLabel && !nextWeekLabel && (
                <div className="move-menu-empty">No hay otro día disponible</div>
              )}
              {sameWeekTargets.map((d) => (
                <button
                  key={d.headingBlockId}
                  type="button"
                  className="move-menu-item"
                  role="menuitem"
                  onClick={() => pick(d)}
                >
                  {d.day}
                </button>
              ))}
              {(previousWeekLabel || nextWeekLabel) && <div className="move-menu-sep" />}
              {previousWeekLabel && (
                <button
                  type="button"
                  className="move-menu-item"
                  onClick={() => void loadWeek(previousWeekLabel)}
                  disabled={loadingWeek !== null}
                >
                  ‹ {loadingWeek === previousWeekLabel ? 'Cargando…' : previousWeekLabel}
                </button>
              )}
              {nextWeekLabel && (
                <button
                  type="button"
                  className="move-menu-item"
                  onClick={() => void loadWeek(nextWeekLabel)}
                  disabled={loadingWeek !== null}
                >
                  {loadingWeek === nextWeekLabel ? 'Cargando…' : nextWeekLabel} ›
                </button>
              )}
              {weekError && <div className="move-menu-error">{weekError}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
