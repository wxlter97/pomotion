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
type View = 'root' | 'move';

/**
 * Menú de acciones de una fila de tarea (⋮): editar, reordenar, mover a otro
 * día/semana y eliminar. Reemplaza la fila de 5 botones sueltos.
 */
export default function TaskRowMenu({
  onEdit,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onDelete,
  onSendToInbox,
  onStartSelect,
  disabled,
  editDisabled,
  isSet,
  currentDay,
  days,
  previousWeekLabel,
  nextWeekLabel,
  fileId,
  onMove,
}: {
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onDelete: () => void;
  /** Sacar la tarea de la agenda (→ inbox). Ausente = no se ofrece
   *  (p. ej. la tarea ya tiene tiempo registrado). */
  onSendToInbox?: () => void;
  /** Entrar en modo selección con esta fila marcada. */
  onStartSelect: () => void;
  /** Timer corriendo o fila ocupada → bloquea mover/reordenar/eliminar. */
  disabled: boolean;
  /** Fila ocupada → bloquea también editar. */
  editDisabled: boolean;
  /** La tarea tiene prioridad/notas/vencimiento → marca el disparador. */
  isSet: boolean;
  currentDay: string | null;
  days: DayColumn[];
  previousWeekLabel: string | null;
  nextWeekLabel: string | null;
  fileId: string | null;
  onMove: (target: MoveTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('root');
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
    setView('root');
    setOtherWeek(null);
    setLoadingWeek(null);
    setWeekError(null);
  }

  function run(fn: () => void) {
    fn();
    close();
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
  const canMove = sameWeekTargets.length > 0 || Boolean(previousWeekLabel) || Boolean(nextWeekLabel);

  return (
    <div className="move-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className={isSet ? 'task-row-menu-trigger is-set' : 'task-row-menu-trigger'}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Acciones de la tarea"
        title="Editar, mover o eliminar"
      >
        ⋮
      </button>

      {open && (
        <div className="move-menu" role="menu">
          {view === 'move' ? (
            otherWeek ? (
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
                <button
                  type="button"
                  className="move-menu-item move-menu-back"
                  onClick={() => setView('root')}
                >
                  ‹ Volver
                </button>
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
            )
          ) : (
            <>
              <button
                type="button"
                className="move-menu-item"
                role="menuitem"
                onClick={() => run(onEdit)}
                disabled={editDisabled}
              >
                Editar
              </button>
              <button
                type="button"
                className="move-menu-item"
                role="menuitem"
                onClick={() => run(onMoveUp)}
                disabled={disabled || !canMoveUp}
              >
                Subir
              </button>
              <button
                type="button"
                className="move-menu-item"
                role="menuitem"
                onClick={() => run(onMoveDown)}
                disabled={disabled || !canMoveDown}
              >
                Bajar
              </button>
              <div className="move-menu-sep" />
              <button
                type="button"
                className="move-menu-item"
                role="menuitem"
                onClick={() => run(onStartSelect)}
              >
                Seleccionar varias
              </button>
              {(canMove || onSendToInbox) && <div className="move-menu-sep" />}
              {canMove && (
                <button
                  type="button"
                  className="move-menu-item"
                  role="menuitem"
                  onClick={() => setView('move')}
                  disabled={disabled}
                >
                  Mover a otro día…
                </button>
              )}
              {onSendToInbox && (
                <button
                  type="button"
                  className="move-menu-item"
                  role="menuitem"
                  onClick={() => run(onSendToInbox)}
                  disabled={disabled}
                >
                  Sacar de la agenda
                </button>
              )}
              <div className="move-menu-sep" />
              <button
                type="button"
                className="move-menu-item move-menu-danger"
                role="menuitem"
                onClick={() => run(onDelete)}
                disabled={disabled}
              >
                Eliminar
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
