import { useEffect, useRef, useState } from 'react';
import { getTasks } from '../api';
import type { DayColumn } from '../types';

export type MoveTarget = {
  /** Fecha del día destino, 'YYYY-MM-DD'. */
  date: string;
  /** Etiqueta legible del destino, para el aviso / errores. */
  destLabel: string;
};

/** Días a los que se puede mover una tarea: todos menos el día actual. Puro. */
export function movableTargets(days: DayColumn[], excludeDay: string | null): DayColumn[] {
  return days.filter((d) => d.day !== excludeDay);
}

type OtherWeek = { label: string; days: DayColumn[] };

export default function MoveTaskMenu({
  currentDay,
  days,
  previousWeekLabel,
  nextWeekLabel,
  fileId,
  disabled,
  onMove,
}: {
  currentDay: string | null;
  days: DayColumn[];
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
      setOtherWeek({ label, days: res.days });
    } catch (err) {
      setWeekError(err instanceof Error ? err.message : 'No se pudo cargar esa semana');
    } finally {
      setLoadingWeek(null);
    }
  }

  function pick(d: DayColumn, weekLabel?: string) {
    onMove({ date: d.date, destLabel: weekLabel ? `${d.day} · ${weekLabel}` : d.day });
    close();
  }

  const sameWeekTargets = movableTargets(days, currentDay);

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
              <button
                type="button"
                className="move-menu-item move-menu-back"
                onClick={() => setOtherWeek(null)}
              >
                ‹ Esta semana
              </button>
              <div className="move-menu-heading">{otherWeek.label}</div>
              {otherWeek.days.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  className="move-menu-item"
                  role="menuitem"
                  onClick={() => pick(d, otherWeek.label)}
                >
                  {d.day}
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="move-menu-heading">Mover a…</div>
              {sameWeekTargets.map((d) => (
                <button
                  key={d.date}
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
