import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth.js';
import { appendBlockChildren, deleteBlock, updateParagraphText } from './_lib/notion.js';

const TIMEZONE = process.env.APP_TIMEZONE || 'America/El_Salvador';
const TIME_RE = /^\d{1,2}:\d{2}$/;

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

function formatSessionText(durationMinutes: number, start: string, end: string): string {
  const rounded = Math.max(1, Math.round(durationMinutes));
  return `⏱ ${rounded}m (${start}–${end})`;
}

async function handleCreate(req: VercelRequest, res: VercelResponse) {
  const body = (req.body ?? {}) as {
    block_id?: string;
    duration_minutes?: number;
    // Timer en vivo: horas completas ISO, se formatean con la zona horaria configurada.
    start_time?: string;
    end_time?: string;
    // Registro manual: el usuario ya escribió la hora tal cual quiere que se vea ("HH:MM").
    start?: string;
    end?: string;
  };
  const {
    block_id: blockId,
    duration_minutes: durationMinutes,
    start_time: startTime,
    end_time: endTime,
    start,
    end,
  } = body;

  if (!blockId || typeof blockId !== 'string') {
    return res.status(400).json({ error: 'invalid_block_id', message: 'Falta block_id' });
  }
  if (typeof durationMinutes !== 'number' || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return res.status(400).json({ error: 'invalid_duration', message: 'duration_minutes inválido' });
  }

  let startLabel: string;
  let endLabel: string;
  if (startTime && endTime) {
    startLabel = formatTime(startTime);
    endLabel = formatTime(endTime);
  } else if (start && end) {
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
      return res.status(400).json({ error: 'invalid_time', message: 'start/end deben ser "HH:MM"' });
    }
    startLabel = start;
    endLabel = end;
  } else {
    return res
      .status(400)
      .json({ error: 'missing_time_range', message: 'Faltan start_time/end_time o start/end' });
  }

  const roundedMinutes = Math.max(1, Math.round(durationMinutes));
  const text = formatSessionText(roundedMinutes, startLabel, endLabel);

  const result = (await appendBlockChildren(blockId, [
    { paragraph: { rich_text: [{ type: 'text', text: { content: text } }] } },
  ])) as { results?: { id?: string }[] };
  const sessionBlockId = result?.results?.[0]?.id;

  return res.status(200).json({
    ok: true,
    session: { blockId: sessionBlockId, durationMinutes: roundedMinutes, start: startLabel, end: endLabel },
  });
}

async function handleUpdate(req: VercelRequest, res: VercelResponse) {
  const body = (req.body ?? {}) as {
    block_id?: string;
    duration_minutes?: number;
    start?: string;
    end?: string;
  };
  const { block_id: blockId, duration_minutes: durationMinutes, start, end } = body;

  if (!blockId || typeof blockId !== 'string') {
    return res.status(400).json({ error: 'invalid_block_id', message: 'Falta block_id' });
  }
  if (typeof durationMinutes !== 'number' || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return res.status(400).json({ error: 'invalid_duration', message: 'duration_minutes inválido' });
  }
  if (!start || !end || !TIME_RE.test(start) || !TIME_RE.test(end)) {
    return res.status(400).json({ error: 'invalid_time', message: 'start/end deben ser "HH:MM"' });
  }

  const roundedMinutes = Math.max(1, Math.round(durationMinutes));
  const text = formatSessionText(roundedMinutes, start, end);
  await updateParagraphText(blockId, text);

  return res.status(200).json({ ok: true, session: { durationMinutes: roundedMinutes, start, end } });
}

async function handleDelete(req: VercelRequest, res: VercelResponse) {
  const body = (req.body ?? {}) as { block_id?: string };
  const blockId = body.block_id;
  if (!blockId || typeof blockId !== 'string') {
    return res.status(400).json({ error: 'invalid_block_id', message: 'Falta block_id' });
  }
  await deleteBlock(blockId);
  return res.status(200).json({ ok: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'POST') return await handleCreate(req, res);
    if (req.method === 'PATCH') return await handleUpdate(req, res);
    if (req.method === 'DELETE') return await handleDelete(req, res);
    res.setHeader('Allow', 'POST, PATCH, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Error desconocido';
    return res.status(500).json({ error: 'internal_error', message });
  }
}
