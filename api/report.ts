import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendError } from './_lib/errors.js';
import { withAuth } from './_lib/handler.js';
import { sqliteStore } from './_lib/sqliteStore.js';
import { formatDurationLabel } from '../shared/duration.js';
import type { SessionRow } from './_lib/taskStore.js';

const CSV_COLUMNS: { header: string; value: (r: SessionRow) => string | number }[] = [
  { header: 'fecha', value: (r) => r.date },
  { header: 'dia', value: (r) => r.day },
  { header: 'semana', value: (r) => r.week },
  { header: 'tarea', value: (r) => r.task },
  { header: 'duracion', value: (r) => formatDurationLabel(r.durationSeconds) },
  { header: 'segundos', value: (r) => r.durationSeconds },
  { header: 'estimado_min', value: (r) => r.estimateMinutes ?? '' },
  { header: 'inicio', value: (r) => r.start },
  { header: 'fin', value: (r) => r.end },
];

/** Suma de la estimación de cada tarea distinta con sesiones en el rango
 *  (cada tarea se cuenta una vez). En minutos; 0 si nadie estimó. */
function estimatedMinutes(rows: SessionRow[]): number {
  const seen = new Map<string, number>();
  for (const r of rows) {
    if (r.estimateMinutes != null) seen.set(r.taskId, r.estimateMinutes);
  }
  return [...seen.values()].reduce((sum, m) => sum + m, 0);
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: SessionRow[]): string {
  const lines = [CSV_COLUMNS.map((c) => c.header).join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((c) => csvCell(c.value(row))).join(','));
  }
  // BOM para que Excel abra el UTF-8 (acentos en "Miércoles", nombres de tarea) bien.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const fileId = typeof req.query.file === 'string' ? req.query.file : undefined;
    const rows = await sqliteStore.getSessionsInRange({ from, to, fileId });

    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="pomotion-${from}_${to}.csv"`);
      return res.status(200).send(toCsv(rows));
    }

    const totalSeconds = rows.reduce((sum, r) => sum + r.durationSeconds, 0);
    return res.status(200).json({ rows, totalSeconds, estimatedMinutes: estimatedMinutes(rows) });
  } catch (err) {
    return sendError(res, err);
  }
}

export default withAuth(handler);
