import type { Task } from './types';

/**
 * Calcula el `after_block_id` (ancla de Notion) para insertar `movingBlockId`
 * en `targetIndex` dentro de `tasks`. Una sola implementación, reusada por
 * los botones ↑/↓ y por el drag-and-drop, para que ambos calculen el mismo
 * resultado ante el mismo movimiento.
 *
 * targetIndex se interpreta sobre la lista SIN la tarea que se mueve (ya
 * removida) — así "moverla a la posición 0" siempre resuelve a
 * dayHeadingBlockId (insertar justo después del heading_3, es decir, al
 * inicio del día).
 */
export function computeAfterBlockId(
  tasks: Task[],
  movingBlockId: string,
  targetIndex: number,
  dayHeadingBlockId: string
): string {
  const others = tasks.filter((t) => t.blockId !== movingBlockId);
  const clamped = Math.max(0, Math.min(targetIndex, others.length));
  return clamped === 0 ? dayHeadingBlockId : others[clamped - 1].blockId;
}
