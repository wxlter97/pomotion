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
import type { Theme } from './types';

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
  const { r, g, b } = hexToRgb(hex);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#000000' : '#ffffff';
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r: r255, g: g255, b: b255 } = hexToRgb(hex);
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
  }
  return { h: h * 60, s: s * 100, l: l * 100 };
}

function hueToRgbChannel(p: number, q: number, tIn: number): number {
  let t = tIn;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360 / 360;
  const ss = Math.min(100, Math.max(0, s)) / 100;
  const ll = Math.min(100, Math.max(0, l)) / 100;

  let r: number, g: number, b: number;
  if (ss === 0) {
    r = g = b = ll;
  } else {
    const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
    const p = 2 * ll - q;
    r = hueToRgbChannel(p, q, hh + 1 / 3);
    g = hueToRgbChannel(p, q, hh);
    b = hueToRgbChannel(p, q, hh - 1 / 3);
  }
  const toHex = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Rango de luminosidad (HSL) observado en los 8 acentos predefinidos:
// ~30-56% en tema claro, ~50-76% en tema oscuro (ver accent.test.ts).
const MAX_LIGHTNESS_LIGHT = 55;
const MIN_LIGHTNESS_DARK = 55;

/** Igual que los presets, que usan una versión más oscura del acento en
 *  tema claro y una más clara en tema oscuro (ej. el "blue" claro es
 *  #2f6fed pero en oscuro es #5b93f7) — sin eso, un color elegido a mano
 *  puede quedar ilegible como texto: una tonalidad pastel casi no se ve
 *  sobre el fondo claro, y una oscura se pierde sobre el fondo casi negro.
 *  Se conserva el matiz/saturación elegidos, solo se acota la luminosidad
 *  (HSL) al rango donde los presets ya se ven bien en cada tema. */
export function accentColorForTheme(hex: string, theme: Theme): string {
  if (!isHexColor(hex)) return hex;
  const { h, s, l } = hexToHsl(hex);
  const clampedL = theme === 'dark' ? Math.max(l, MIN_LIGHTNESS_DARK) : Math.min(l, MAX_LIGHTNESS_LIGHT);
  if (clampedL === l) return hex; // ya estaba en rango — no perder precisión redondeando ida y vuelta
  return hslToHex(h, s, clampedL);
}
