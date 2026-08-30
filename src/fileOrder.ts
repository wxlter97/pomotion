import type { FileEntry } from './types';

/**
 * Reordena `files` según `order` (lista de ids preferida del usuario). Los
 * que no están en `order` van al final, conservando su orden original (el
 * alfabético que manda el server). Puro — testeado en fileOrder.test.ts.
 */
export function orderFiles(files: FileEntry[], order: string[]): FileEntry[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return files
    .map((file, i) => ({ file, i }))
    .sort((a, b) => {
      const ra = rank.get(a.file.id);
      const rb = rank.get(b.file.id);
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return a.i - b.i; // ambos sin ranking → orden original
    })
    .map((x) => x.file);
}

/** Mueve el elemento en `from` a la posición `to` (con clamp). Puro. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}
