import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { baseCanDrop, parseZoneTag, type DragItem, type DropZone } from './dnd';

type DragCtx = {
  /**
   * Empieza a seguir el puntero. El arrastre real no arranca hasta superar
   * el umbral (mouse) o mantener presionado sin moverse (touch), así un tap
   * o un scroll normal siguen funcionando.
   */
  beginDrag: (item: DragItem, e: ReactPointerEvent, label: string) => void;
  /** id de la tarea que se está arrastrando ahora (para atenuar su fila). */
  draggingId: string | null;
};

const Ctx = createContext<DragCtx | null>(null);

export function useDrag(): DragCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDrag() fuera de <DragProvider>');
  return ctx;
}

const MOUSE_THRESHOLD = 5; // px de movimiento para arrancar el drag con mouse
const TOUCH_HOLD_MS = 240; // mantener presionado para arrancar con el dedo
const TOUCH_SLOP = 10; // si el dedo se mueve más que esto antes del hold, es scroll
const EDGE = 64; // banda (px) junto al borde del viewport que dispara autoscroll
const EDGE_SPEED = 16; // px por frame de autoscroll

type Gesture = {
  item: DragItem;
  label: string;
  pointerId: number;
  isTouch: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  dragging: boolean;
  holdTimer: number | null;
  raf: number | null;
  zoneEl: HTMLElement | null;
  zone: DropZone | null;
  accepts: boolean;
};

type Deps = {
  ghostRef: { current: HTMLDivElement | null };
  canDrop: () => (item: DragItem, zone: DropZone) => boolean;
  onDrop: () => (item: DragItem, zone: DropZone) => void;
  onActiveChange: (id: string | null, label: string) => void;
};

/**
 * Controlador de arrastre por pointer events, hecho a mano (sin dependencias).
 * Una sola instancia por provider; identidad estable, así los
 * add/removeEventListener siempre matchean aunque el provider re-renderice.
 */
function makeController(deps: Deps) {
  let g: Gesture | null = null;

  function paintZone(el: HTMLElement | null, state: 'hot' | 'reject' | null) {
    if (!el) return;
    if (state) el.setAttribute('data-drop-state', state);
    else el.removeAttribute('data-drop-state');
  }

  function updateZone(x: number, y: number) {
    if (!g || !g.dragging) return;
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    const zoneEl = (hit?.closest('[data-drag-zone]') as HTMLElement | null) ?? null;
    const tag = zoneEl ? parseZoneTag(zoneEl.getAttribute('data-drag-zone')) : null;

    let zone: DropZone | null = null;
    if (tag) {
      if (tag.kind === 'row') {
        const r = zoneEl!.getBoundingClientRect();
        zone = { kind: 'row', index: tag.index, after: y > r.top + r.height / 2 };
      } else {
        zone = tag;
      }
    }
    const accepts = !!zone && baseCanDrop(g.item, zone) && deps.canDrop()(g.item, zone);

    if (g.zoneEl && g.zoneEl !== zoneEl) paintZone(g.zoneEl, null);
    if (zoneEl) paintZone(zoneEl, zone ? (accepts ? 'hot' : 'reject') : null);

    g.zoneEl = zoneEl;
    g.zone = zone;
    g.accepts = accepts;
  }

  function autoScrollTick() {
    if (!g || !g.dragging) return;
    const { lastX, lastY } = g;
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    if (lastY < EDGE) window.scrollBy(0, -EDGE_SPEED * ((EDGE - lastY) / EDGE));
    else if (lastY > vh - EDGE) window.scrollBy(0, EDGE_SPEED * ((lastY - (vh - EDGE)) / EDGE));

    const tabs = (document.elementFromPoint(lastX, lastY) as HTMLElement | null)?.closest(
      '.day-tabs'
    ) as HTMLElement | null;
    if (tabs) {
      if (lastX < EDGE) tabs.scrollLeft -= EDGE_SPEED;
      else if (lastX > vw - EDGE) tabs.scrollLeft += EDGE_SPEED;
    }

    updateZone(lastX, lastY);
    g.raf = requestAnimationFrame(autoScrollTick);
  }

  function moveGhost(x: number, y: number) {
    const el = deps.ghostRef.current;
    if (el) el.style.transform = `translate(${x + 12}px, ${y + 14}px)`;
  }

  function preventTouchScroll(e: TouchEvent) {
    if (g?.dragging) e.preventDefault();
  }

  function teardown() {
    const s = g;
    g = null;
    if (s) {
      if (s.holdTimer != null) window.clearTimeout(s.holdTimer);
      if (s.raf != null) cancelAnimationFrame(s.raf);
      paintZone(s.zoneEl, null);
    }
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('touchmove', preventTouchScroll);
    document.body.classList.remove('is-dragging');
    deps.onActiveChange(null, '');
  }

  function startDrag() {
    if (!g || g.dragging) return;
    g.dragging = true;
    if (g.holdTimer != null) {
      window.clearTimeout(g.holdTimer);
      g.holdTimer = null;
    }
    document.body.classList.add('is-dragging');
    document.addEventListener('touchmove', preventTouchScroll, { passive: false });
    deps.onActiveChange(g.item.task.id, g.label);
    updateZone(g.lastX, g.lastY);
    g.raf = requestAnimationFrame(autoScrollTick);
  }

  function finishDrop() {
    const s = g;
    if (s && s.dragging && s.zone && s.accepts) {
      // Tragar el click sintético que dispara el pointerup tras arrastrar,
      // para que soltar sobre una fila no la "seleccione" además.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      deps.onDrop()(s.item, s.zone);
    }
    teardown();
  }

  function onPointerMove(e: PointerEvent) {
    if (!g || e.pointerId !== g.pointerId) return;
    g.lastX = e.clientX;
    g.lastY = e.clientY;

    if (!g.dragging) {
      const dist = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);
      if (g.isTouch) {
        if (dist > TOUCH_SLOP) teardown(); // se movió antes del hold => es scroll
      } else if (dist > MOUSE_THRESHOLD) {
        startDrag();
      }
      return;
    }

    e.preventDefault();
    moveGhost(e.clientX, e.clientY);
    updateZone(e.clientX, e.clientY);
  }

  function onPointerUp(e: PointerEvent) {
    if (!g || e.pointerId !== g.pointerId) return;
    if (g.dragging) finishDrop();
    else teardown();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && g) {
      e.preventDefault();
      teardown();
    }
  }

  function beginDrag(item: DragItem, e: ReactPointerEvent, label: string) {
    if (g) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const isTouch = e.pointerType !== 'mouse';
    g = {
      item,
      label,
      pointerId: e.pointerId,
      isTouch,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      dragging: false,
      holdTimer: null,
      raf: null,
      zoneEl: null,
      zone: null,
      accepts: false,
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keydown', onKeyDown, true);
    if (isTouch) g.holdTimer = window.setTimeout(startDrag, TOUCH_HOLD_MS);
  }

  return { beginDrag, teardown, syncGhost: () => g && moveGhost(g.lastX, g.lastY) };
}

export default function DragProvider({
  children,
  canDrop,
  onDrop,
}: {
  children: ReactNode;
  /** Filtro extra (además de `baseCanDrop`) con el contexto de la app. */
  canDrop: (item: DragItem, zone: DropZone) => boolean;
  onDrop: (item: DragItem, zone: DropZone) => void;
}) {
  const [active, setActive] = useState<{ id: string; label: string } | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);

  const canDropRef = useRef(canDrop);
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    canDropRef.current = canDrop;
  }, [canDrop]);
  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  const ctrlRef = useRef<ReturnType<typeof makeController> | null>(null);
  if (!ctrlRef.current) {
    ctrlRef.current = makeController({
      ghostRef,
      canDrop: () => canDropRef.current,
      onDrop: () => onDropRef.current,
      onActiveChange: (id, label) => setActive(id ? { id, label } : null),
    });
  }
  const ctrl = ctrlRef.current;

  // Posiciona el ghost apenas monta (el estado que lo monta es asíncrono).
  useLayoutEffect(() => {
    if (active) ctrl.syncGhost();
  }, [active, ctrl]);

  useEffect(() => () => ctrl.teardown(), [ctrl]);

  return (
    <Ctx.Provider value={{ beginDrag: ctrl.beginDrag, draggingId: active?.id ?? null }}>
      {children}
      {active &&
        createPortal(
          <div ref={ghostRef} className="drag-ghost" aria-hidden="true">
            {active.label || '(sin texto)'}
          </div>,
          document.body
        )}
    </Ctx.Provider>
  );
}
