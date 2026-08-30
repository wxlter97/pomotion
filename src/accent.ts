/**
 * Acentos de color configurables. La clave se guarda en localStorage
 * ('pomotion:accent') y se aplica como `data-accent` en <html>; el color
 * real (claro/oscuro) lo resuelve el CSS. `tomato` es el default y no
 * necesita reglas propias.
 *
 * Mantener la lista de claves en sync con el <script> anti-flash de
 * index.html y con los bloques `[data-accent=…]` de styles.css.
 */
export type Accent =
  | 'tomato'
  | 'amber'
  | 'green'
  | 'teal'
  | 'blue'
  | 'indigo'
  | 'pink'
  | 'graphite';

export const ACCENTS: { key: Accent }[] = [
  { key: 'tomato' }, { key: 'amber' }, { key: 'green' }, { key: 'teal' },
  { key: 'blue' }, { key: 'indigo' }, { key: 'pink' }, { key: 'graphite' },
];

export const DEFAULT_ACCENT: Accent = 'tomato';

const KEYS = new Set<string>(ACCENTS.map((a) => a.key));

export function isAccent(value: unknown): value is Accent {
  return typeof value === 'string' && KEYS.has(value);
}
