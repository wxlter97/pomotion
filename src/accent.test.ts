import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACCENTS, accentColorForTheme, contrastColorFor, DEFAULT_ACCENT, isAccent, isHexColor } from './accent';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('accent', () => {
  it('isAccent solo acepta claves conocidas', () => {
    expect(isAccent('blue')).toBe(true);
    expect(isAccent('tomato')).toBe(true);
    expect(isAccent('turquoise')).toBe(false);
    expect(isAccent(null)).toBe(false);
    expect(isAccent(42)).toBe(false);
  });

  it('la lista no tiene claves repetidas y contiene el default', () => {
    const keys = ACCENTS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(DEFAULT_ACCENT);
  });

  it('cada acento no-default tiene su bloque claro y oscuro en styles.css', () => {
    const css = readFileSync(join(root, 'src/styles.css'), 'utf8');
    for (const { key } of ACCENTS) {
      if (key === DEFAULT_ACCENT) continue;
      expect(css).toContain(`:root[data-accent='${key}']`);
      expect(css).toContain(`:root[data-theme='dark'][data-accent='${key}']`);
      expect(css).toContain(`.accent-swatch[data-accent='${key}']`);
    }
  });

  it('el <script> anti-flash de index.html lista exactamente las mismas claves', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    const match = html.match(/var accents = \[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const inHtml = match![1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
    expect(inHtml.sort()).toEqual(ACCENTS.map((a) => a.key).sort());
  });

  it('"custom" no es un preset de ACCENTS (tiene su propio picker) pero sí es una clave válida', () => {
    expect(ACCENTS.some((a) => a.key === 'custom')).toBe(false);
    expect(isAccent('custom')).toBe(true);
  });
});

describe('isHexColor', () => {
  it('acepta "#rrggbb"', () => {
    expect(isHexColor('#ff5f3d')).toBe(true);
    expect(isHexColor('#FFFFFF')).toBe(true);
  });

  it('rechaza cualquier otra cosa', () => {
    expect(isHexColor('ff5f3d')).toBe(false);
    expect(isHexColor('#fff')).toBe(false);
    expect(isHexColor('#gggggg')).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });
});

describe('contrastColorFor', () => {
  it('blanco encima de un color oscuro', () => {
    expect(contrastColorFor('#1c1c1e')).toBe('#ffffff');
  });

  it('negro encima de un color claro', () => {
    expect(contrastColorFor('#ffeb3b')).toBe('#000000');
  });

  it('color inválido cae a blanco', () => {
    expect(contrastColorFor('not-a-color')).toBe('#ffffff');
  });
});

describe('accentColorForTheme', () => {
  it('oscurece un color pastel para que se lea como texto en tema claro', () => {
    // #fffacd (amarillo pálido, L≈90%) queda casi invisible como texto
    // sobre el fondo claro — se acota a la misma luminosidad que usan los
    // presets (≤55%), conservando el matiz.
    expect(accentColorForTheme('#fffacd', 'light')).toBe('#ffe81a');
  });

  it('aclara un color oscuro para que se lea como texto en tema oscuro', () => {
    // #00008b (azul muy oscuro, L≈27%) se pierde sobre el fondo casi negro.
    expect(accentColorForTheme('#00008b', 'dark')).toBe('#1a1aff');
  });

  it('no toca un color que ya está en el rango legible de ese tema', () => {
    expect(accentColorForTheme('#00008b', 'light')).toBe('#00008b'); // oscuro: perfecto en claro
    expect(accentColorForTheme('#fffacd', 'dark')).toBe('#fffacd'); // pálido: perfecto en oscuro
  });

  it('el color ajustado sigue teniendo un contraste válido calculable encima', () => {
    // #00008b clampeado a L=55% en oscuro pasa de necesitar blanco (muy
    // oscuro) a necesitar blanco igual pero ya no tan cerca del negro —
    // lo que importa es que el contraste se recalcula sobre el color
    // aplicado, no sobre el original.
    const applied = accentColorForTheme('#00008b', 'dark');
    expect(applied).not.toBe('#00008b');
    expect(contrastColorFor(applied)).toBe('#ffffff');
  });

  it('color inválido se devuelve tal cual', () => {
    expect(accentColorForTheme('not-a-color', 'light')).toBe('not-a-color');
  });
});
