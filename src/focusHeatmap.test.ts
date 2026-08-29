import { describe, expect, it } from 'vitest';
import {
  focusDateLabel,
  heatmapColumns,
  intensityLevel,
  monthLabels,
} from './focusHeatmap';

describe('heatmapColumns', () => {
  it('arma columnas de 7 (lun→dom) desde un lunes hasta la semana de endDate', () => {
    // 2026-08-03 es lunes; 2026-08-19 es miércoles.
    const cols = heatmapColumns('2026-08-03', '2026-08-19');
    expect(cols).toHaveLength(3);
    expect(cols[0][0]).toBe('2026-08-03');
    expect(cols[0][6]).toBe('2026-08-09');
    // Última columna: mié 19 real, jue–dom en el futuro → null.
    expect(cols[2]).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      null,
      null,
      null,
      null,
    ]);
  });

  it('no deja null si endDate cae domingo', () => {
    const cols = heatmapColumns('2026-08-03', '2026-08-09');
    expect(cols).toHaveLength(1);
    expect(cols[0].every((d) => d !== null)).toBe(true);
  });
});

describe('intensityLevel', () => {
  it('mapea segundos a 0..4 por umbrales fijos', () => {
    expect(intensityLevel(0)).toBe(0);
    expect(intensityLevel(30)).toBe(0); // < 1 min
    expect(intensityLevel(20 * 60)).toBe(1);
    expect(intensityLevel(60 * 60)).toBe(2);
    expect(intensityLevel(150 * 60)).toBe(3);
    expect(intensityLevel(300 * 60)).toBe(4);
  });
});

describe('monthLabels', () => {
  it('etiqueta la primera columna de cada mes nuevo', () => {
    const cols = heatmapColumns('2026-07-27', '2026-09-07');
    const labels = monthLabels(cols);
    expect(labels[0]).toEqual({ index: 0, label: 'jul' });
    expect(labels.map((l) => l.label)).toEqual(['jul', 'ago', 'sep']);
    // ago arranca en la columna cuyo lunes es 2026-08-03 (índice 1).
    expect(labels[1].index).toBe(1);
  });
});

describe('focusDateLabel', () => {
  it('formatea "D mmm"', () => {
    expect(focusDateLabel('2026-03-05')).toBe('5 mar');
    expect(focusDateLabel('2026-12-25')).toBe('25 dic');
  });
});
