import { describe, expect, it } from 'vitest';
import { DEFAULT_TAG_COLOR, resolveTags, tagColorOf } from './tags';
import type { Tag } from './types';

describe('tagColorOf', () => {
  it('acepta claves conocidas y cae al default para el resto', () => {
    expect(tagColorOf('blue')).toBe('blue');
    expect(tagColorOf('fucsia')).toBe(DEFAULT_TAG_COLOR);
    expect(tagColorOf(null)).toBe(DEFAULT_TAG_COLOR);
    expect(tagColorOf(undefined)).toBe(DEFAULT_TAG_COLOR);
  });
});

describe('resolveTags', () => {
  const all: Tag[] = [
    { id: 'a', name: 'Admin', color: 'slate' },
    { id: 'b', name: 'Bugs', color: 'red' },
    { id: 'c', name: 'Cliente', color: 'green' },
  ];

  it('devuelve los tags de los ids, en el orden de allTags', () => {
    expect(resolveTags(['c', 'a'], all).map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('descarta ids que ya no existen', () => {
    expect(resolveTags(['b', 'zz'], all).map((t) => t.id)).toEqual(['b']);
  });

  it('lista vacía → []', () => {
    expect(resolveTags([], all)).toEqual([]);
  });
});
