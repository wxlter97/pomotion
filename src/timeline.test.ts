import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLOCK_MINUTES,
  MIN_BLOCK_MINUTES,
  blockDurationMinutes,
  clampBlockDuration,
  clampBlockStart,
  layoutColumns,
  minutesToTime,
  plannedRange,
  sessionRange,
  snapMinutes,
  timeToMinutes,
} from './timeline';

describe('timeToMinutes / minutesToTime', () => {
  it('convierte "HH:MM" a minutos desde la medianoche', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('23:45')).toBe(1425);
  });

  it('hace el viaje de ida y vuelta', () => {
    for (const hhmm of ['00:00', '09:05', '13:40', '23:59']) {
      expect(minutesToTime(timeToMinutes(hhmm))).toBe(hhmm);
    }
  });

  it('minutesToTime hace wrap de valores fuera de 0..1440', () => {
    expect(minutesToTime(-30)).toBe('23:30');
    expect(minutesToTime(1440 + 15)).toBe('00:15');
  });
});

describe('snapMinutes', () => {
  it('redondea al paso más cercano (5 min por default)', () => {
    expect(snapMinutes(12)).toBe(10);
    expect(snapMinutes(13)).toBe(15);
    expect(snapMinutes(37, 15)).toBe(30);
  });
});

describe('clampBlockStart / clampBlockDuration', () => {
  it('no deja arrancar antes de las 00:00 ni tan tarde que no entre un bloque mínimo', () => {
    expect(clampBlockStart(-10)).toBe(0);
    expect(clampBlockStart(1440)).toBe(1440 - MIN_BLOCK_MINUTES);
  });

  it('recorta la duración al piso y a lo que queda del día', () => {
    expect(clampBlockDuration(600, 0)).toBe(MIN_BLOCK_MINUTES);
    expect(clampBlockDuration(1430, 120)).toBe(10);
  });
});

describe('blockDurationMinutes', () => {
  it('usa lo redimensionado a mano si existe', () => {
    expect(blockDurationMinutes(45, 90)).toBe(45);
  });
  it('si no, la estimación', () => {
    expect(blockDurationMinutes(null, 90)).toBe(90);
  });
  it('si no hay ninguna, el default', () => {
    expect(blockDurationMinutes(null, null)).toBe(DEFAULT_BLOCK_MINUTES);
  });
});

describe('plannedRange', () => {
  it('arma [inicio, fin) a partir de la hora y la duración efectiva', () => {
    expect(plannedRange('09:00', 60, null)).toEqual({ start: 540, end: 600 });
    expect(plannedRange('09:00', null, 90)).toEqual({ start: 540, end: 630 });
  });

  it('recorta al final del día si el bloque se pasaría de medianoche', () => {
    expect(plannedRange('23:45', 60, null)).toEqual({ start: 1425, end: 1440 });
  });
});

describe('sessionRange', () => {
  it('arma [inicio, fin) normal', () => {
    expect(sessionRange('09:00', '10:30')).toEqual({ start: 540, end: 630 });
  });

  it('recorta al final del día si la sesión cruza la medianoche', () => {
    expect(sessionRange('23:30', '00:15')).toEqual({ start: 1410, end: 1440 });
  });
});

describe('layoutColumns', () => {
  it('bloques que no se tocan quedan todos en columna única', () => {
    const items = [
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 120, end: 180 },
    ];
    const layout = layoutColumns(items);
    expect(layout.get('a')).toEqual({ col: 0, cols: 1 });
    expect(layout.get('b')).toEqual({ col: 0, cols: 1 });
  });

  it('dos bloques que se solapan se reparten dos columnas', () => {
    const items = [
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 30, end: 90 },
    ];
    const layout = layoutColumns(items);
    expect(layout.get('a')).toEqual({ col: 0, cols: 2 });
    expect(layout.get('b')).toEqual({ col: 1, cols: 2 });
  });

  it('tres bloques mutuamente solapados usan tres columnas', () => {
    const items = [
      { id: 'a', start: 0, end: 90 },
      { id: 'b', start: 10, end: 100 },
      { id: 'c', start: 20, end: 110 },
    ];
    const layout = layoutColumns(items);
    const cols = new Set(items.map((i) => layout.get(i.id)!.col));
    expect(cols.size).toBe(3);
    for (const i of items) expect(layout.get(i.id)!.cols).toBe(3);
  });

  it('un bloque que termina justo cuando otro arranca no se considera solapado', () => {
    const items = [
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 60, end: 120 },
    ];
    const layout = layoutColumns(items);
    expect(layout.get('a')).toEqual({ col: 0, cols: 1 });
    expect(layout.get('b')).toEqual({ col: 0, cols: 1 });
  });

  it('reusa una columna liberada cuando un tercer bloque llega después', () => {
    // a: 0-60 se solapa con b y con c, pero b (0-30) y c (40-70) no se
    // solapan entre sí → alcanza con 2 columnas: a sola en una, b y c
    // comparten la otra (c entra después de que b ya terminó).
    const items = [
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 0, end: 30 },
      { id: 'c', start: 40, end: 70 },
    ];
    const layout = layoutColumns(items);
    expect(layout.get('b')!.col).toBe(layout.get('c')!.col);
    expect(layout.get('a')!.col).not.toBe(layout.get('b')!.col);
    for (const i of items) expect(layout.get(i.id)!.cols).toBe(2);
  });
});
