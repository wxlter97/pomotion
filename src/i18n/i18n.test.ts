import { describe, expect, it } from 'vitest';
import { es } from './es';
import { en } from './en';
import { localizeDay, makeT, monthName, plural } from './index';

describe('diccionarios', () => {
  it('en tiene exactamente las mismas claves que es', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
  });

  it('ninguna traducción está vacía (salvo las marcadas a propósito)', () => {
    const allowedEmpty = new Set(['file.oneContextMode']);
    for (const [k, v] of Object.entries(en)) {
      if (!allowedEmpty.has(k)) expect(v, `en.${k} vacío`).not.toBe('');
    }
    for (const [k, v] of Object.entries(es)) {
      if (!allowedEmpty.has(k)) expect(v, `es.${k} vacío`).not.toBe('');
    }
  });

  it('los placeholders {x} coinciden entre es y en', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const k of Object.keys(es) as (keyof typeof es)[]) {
      expect(ph(en[k]), `placeholders distintos en ${k}`).toBe(ph(es[k]));
    }
  });
});

describe('makeT', () => {
  it('devuelve el texto del idioma', () => {
    expect(makeT('es')('common.save')).toBe('Guardar');
    expect(makeT('en')('common.save')).toBe('Save');
  });

  it('interpola {param}', () => {
    expect(makeT('en')('carryOver.many', { count: 3 })).toBe('You have 3 unfinished tasks from past days.');
  });

  it('cae a español si falta la clave en otro idioma', () => {
    // @ts-expect-error clave inexistente a propósito
    expect(makeT('en')('no.existe')).toBe('no.existe');
  });
});

describe('plural / localizeDay / monthName', () => {
  it('plural', () => {
    expect(plural(1, 'tarea', 'tareas')).toBe('tarea');
    expect(plural(0, 'tarea', 'tareas')).toBe('tareas');
    expect(plural(5, 'task', 'tasks')).toBe('tasks');
  });

  it('localizeDay', () => {
    expect(localizeDay('Miércoles', 'en')).toBe('Wednesday');
    expect(localizeDay('Miércoles', 'es')).toBe('Miércoles');
    expect(localizeDay('Lunes', 'en')).toBe('Monday');
  });

  it('monthName', () => {
    expect(monthName(0, 'en')).toBe('January');
    expect(monthName(0, 'es', true)).toBe('Enero');
    expect(monthName(8, 'es')).toBe('septiembre');
  });
});
