import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACCENTS, DEFAULT_ACCENT, isAccent } from './accent';

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
});
