/**
 * Calcula el `afterId` para insertar `movingId` en `targetIndex` dentro de
 * `tasks`. Una sola implementación, reusada por los botones ↑/↓ y por el
 * drag-and-drop, para que ambos calculen el mismo resultado.
 *
 * `targetIndex` se interpreta sobre la lista SIN la tarea que se mueve (ya
 * removida). `null` = al inicio del día; un id = justo después de esa tarea.
 */
export function computeAfterId(
  tasks: { id: string }[],
  movingId: string,
  targetIndex: number
): string | null {
  const others = tasks.filter((t) => t.id !== movingId);
  const clamped = Math.max(0, Math.min(targetIndex, others.length));
  return clamped === 0 ? null : others[clamped - 1].id;
}
