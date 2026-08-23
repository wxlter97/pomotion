import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth';
import { appendBlockChildren } from './_lib/notion';

const TIMEZONE = process.env.APP_TIMEZONE || 'America/El_Salvador';

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Fecha inválida: "${iso}"`);
  }
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!requireAuth(req, res)) return;

  const body = (req.body ?? {}) as {
    block_id?: string;
    duration_minutes?: number;
    start_time?: string;
    end_time?: string;
  };
  const { block_id: blockId, duration_minutes: durationMinutes, start_time: startTime, end_time: endTime } =
    body;

  if (!blockId || typeof blockId !== 'string') {
    return res.status(400).json({ error: 'invalid_block_id', message: 'Falta block_id' });
  }
  if (typeof durationMinutes !== 'number' || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return res.status(400).json({ error: 'invalid_duration', message: 'duration_minutes inválido' });
  }
  if (!startTime || !endTime) {
    return res.status(400).json({ error: 'missing_time_range', message: 'Faltan start_time/end_time' });
  }

  try {
    const startLabel = formatTime(startTime);
    const endLabel = formatTime(endTime);
    const roundedMinutes = Math.max(1, Math.round(durationMinutes));
    const text = `⏱ ${roundedMinutes}m (${startLabel}–${endLabel})`;

    await appendBlockChildren(blockId, [
      { paragraph: { rich_text: [{ type: 'text', text: { content: text } }] } },
    ]);

    return res.status(200).json({
      ok: true,
      session: { durationMinutes: roundedMinutes, start: startLabel, end: endLabel },
    });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Error desconocido';
    return res.status(500).json({ error: 'internal_error', message });
  }
}
