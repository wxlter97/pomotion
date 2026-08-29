import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Menú desplegable genérico: un disparador + un popover que se cierra al
 * hacer clic afuera o con Escape. `children` recibe `close` para que cada
 * ítem decida si cerrar (navegar) o no (togglear un ajuste y seguir).
 */
export default function Menu({
  trigger,
  triggerClassName = 'menu-trigger',
  ariaLabel,
  align = 'end',
  disabled,
  children,
}: {
  trigger: ReactNode;
  triggerClassName?: string;
  ariaLabel?: string;
  align?: 'start' | 'end';
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {trigger}
      </button>
      {open && (
        <div className={align === 'start' ? 'menu-pop menu-pop--start' : 'menu-pop'} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onClick,
  disabled,
  danger,
  state,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Valor actual del ajuste, alineado a la derecha (p. ej. "Sí" / "No"). */
  state?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={danger ? 'menu-item menu-item--danger' : 'menu-item'}
      onClick={onClick}
      disabled={disabled}
    >
      <span>{children}</span>
      {state != null && <span className="menu-item-state">{state}</span>}
    </button>
  );
}
