/**
 * Paleta de colores de etiquetas. La clave se guarda en `tags.color`; el
 * color real (claro/oscuro) lo resuelve el CSS vía `[data-tag-color]`.
 * Mantener en sync con TAG_COLORS en api/_lib/sqliteStore.ts.
 */
import type { Tag } from './types';

export type TagColor =
  | 'slate'
  | 'red'
  | 'orange'
  | 'amber'
  | 'green'
  | 'teal'
  | 'blue'
  | 'violet'
  | 'pink';

export const TAG_COLORS: { key: TagColor; label: string }[] = [
  { key: 'slate', label: 'Gris' },
  { key: 'red', label: 'Rojo' },
  { key: 'orange', label: 'Naranja' },
  { key: 'amber', label: 'Ámbar' },
  { key: 'green', label: 'Verde' },
  { key: 'teal', label: 'Turquesa' },
  { key: 'blue', label: 'Azul' },
  { key: 'violet', label: 'Violeta' },
  { key: 'pink', label: 'Rosa' },
];

export const DEFAULT_TAG_COLOR: TagColor = 'slate';

const KEYS = new Set<string>(TAG_COLORS.map((c) => c.key));

export function tagColorOf(color: string | null | undefined): TagColor {
  return color != null && KEYS.has(color) ? (color as TagColor) : DEFAULT_TAG_COLOR;
}

/** Resuelve una lista de ids a los objetos `Tag`, preservando el orden de
 *  `allTags` (alfabético) y descartando ids que ya no existen. */
export function resolveTags(ids: string[], allTags: Tag[]): Tag[] {
  const set = new Set(ids);
  return allTags.filter((t) => set.has(t.id));
}
