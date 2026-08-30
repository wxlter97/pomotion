import { describe, expect, it } from 'vitest';
import { moveItem, orderFiles } from './fileOrder';
import type { FileEntry } from './types';

const files: FileEntry[] = [
  { id: 'Casa', label: 'Casa' },
  { id: 'Estudio', label: 'Estudio' },
  { id: 'Trabajo', label: 'Trabajo' },
];

describe('orderFiles', () => {
  it('reordena según la lista guardada', () => {
    expect(orderFiles(files, ['Trabajo', 'Casa', 'Estudio']).map((f) => f.id)).toEqual([
      'Trabajo',
      'Casa',
      'Estudio',
    ]);
  });

  it('los que no están en el orden van al final, en su orden original', () => {
    expect(orderFiles(files, ['Trabajo']).map((f) => f.id)).toEqual(['Trabajo', 'Casa', 'Estudio']);
  });

  it('ignora ids del orden que ya no existen', () => {
    expect(orderFiles(files, ['Viejo', 'Trabajo']).map((f) => f.id)).toEqual([
      'Trabajo',
      'Casa',
      'Estudio',
    ]);
  });

  it('orden vacío → deja todo como viene', () => {
    expect(orderFiles(files, []).map((f) => f.id)).toEqual(['Casa', 'Estudio', 'Trabajo']);
  });
});

describe('moveItem', () => {
  it('mueve hacia abajo', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });
  it('mueve hacia arriba', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });
  it('clampa el destino', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a']);
  });
  it('índice de origen inválido → sin cambios', () => {
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});
