/**
 * Acentos de color configurables. La clave se guarda en localStorage
 * ('pomotion:accent') y se aplica como `data-accent` en <html>; el color
 * real (claro/oscuro) lo resuelve el CSS. `tomato` es el default y no
 * necesita reglas propias.
 *
 * 'custom' es distinto de los demás: no tiene bloque CSS propio, el color
 * elegido con el color picker ('pomotion:accent-custom-color') se aplica
 * como variables inline sobre <html> (ver useAccent.ts) en vez de por
 * `data-accent`.
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
  | 'graphite'
  | 'custom';

export const ACCENTS: { key: Accent }[] = [
  { key: 'tomato' }, { key: 'amber' }, { key: 'green' }, { key: 'teal' },
  { key: 'blue' }, { key: 'indigo' }, { key: 'pink' }, { key: 'graphite' },
];

export const DEFAULT_ACCENT: Accent = 'tomato';

/** Color de partida del picker cuando el usuario nunca eligió uno a mano. */
export const DEFAULT_CUSTOM_COLOR = '#ff5f3d';

const KEYS = new Set<string>([...ACCENTS.map((a) => a.key), 'custom']);

export function isAccent(value: unknown): value is Accent {
  return typeof value === 'string' && KEYS.has(value);
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value);
}

/**
 * Negro o blanco, lo que dé más contraste sobre `hex` — para el texto/ícono
 * que va encima del acento (mismo rol que `--color-accent-contrast`).
 * Fórmula YIQ (perceptual, umbral estándar 128/255): rápida y suficiente
 * para este uso, no hace falta el cálculo WCAG completo.
 */
export function contrastColorFor(hex: string): '#ffffff' | '#000000' {
  if (!isHexColor(hex)) return '#ffffff';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#000000' : '#ffffff';
}
