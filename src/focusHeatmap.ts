import { monthAbbr, type Lang } from './i18n';

/**
 * Helpers puros para el heatmap de foco: grilla estilo GitHub (una columna
 * por semana, una fila por día de la semana, lunes arriba), niveles de
 * intensidad y etiquetas de mes.
 *
 * Aritmética en UTC — es puro calendario; "hoy" llega resuelto del server.
 */

/** Etiquetas de fila; solo lun/mié/vie llevan texto (como GitHub). */
export const HEATMAP_ROW_LABELS = ['L', '', 'X', '', 'V', '', ''] as const;

function parseYmd(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = parseYmd(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}

/**
 * Columnas de la grilla: desde `startDate` (un lunes) hasta la semana que
 * contiene `endDate`. Cada columna son 7 celdas (lunes→domingo); `null` para
 * los días posteriores a `endDate` (futuro de la última semana).
 */
export function heatmapColumns(startDate: string, endDate: string): (string | null)[][] {
  const columns: (string | null)[][] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const col: (string | null)[] = [];
    for (let i = 0; i < 7; i++) {
      col.push(cursor <= endDate ? cursor : null);
      cursor = addDays(cursor, 1);
    }
    columns.push(col);
  }
  return columns;
}

/**
 * Nivel de intensidad 0..4 según los segundos registrados ese día. Umbrales
 * fijos (no cuartiles): para un usuario de pomodoros, "4h+" siempre debería
 * pintar fuerte aunque sea su día más flojo del rango.
 */
export function intensityLevel(seconds: number): 0 | 1 | 2 | 3 | 4 {
  const minutes = seconds / 60;
  if (minutes < 1) return 0;
  if (minutes < 45) return 1;
  if (minutes < 120) return 2;
  if (minutes < 240) return 3;
  return 4;
}

/**
 * Para la fila de etiquetas superior: por cada columna en la que arranca un
 * mes distinto al de la etiqueta anterior, su índice (0-based) y la
 * abreviatura del mes.
 */
export function monthLabels(columns: (string | null)[][], lang: Lang = 'es'): { index: number; label: string }[] {
  const labels: { index: number; label: string }[] = [];
  let lastMonth = -1;
  columns.forEach((col, i) => {
    const first = col.find((d): d is string => d != null);
    if (!first) return;
    const month = Number(first.slice(5, 7)) - 1;
    if (month !== lastMonth) {
      labels.push({ index: i, label: monthAbbr(month, lang) });
      lastMonth = month;
    }
  });
  return labels;
}

/** "5 mar" a partir de "YYYY-MM-DD" (para el tooltip de la celda). */
export function focusDateLabel(dateStr: string, lang: Lang = 'es'): string {
  const [, m, d] = dateStr.split('-');
  const abbr = monthAbbr(Number(m) - 1, lang);
  return lang === 'en' ? `${abbr} ${Number(d)}` : `${Number(d)} ${abbr}`;
}
