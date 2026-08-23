import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth.js';
import { setToDoChecked } from './_lib/notion.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!requireAuth(req, res)) return;

  const body = (req.body ?? {}) as { block_id?: string; checked?: boolean };
  const { block_id: blockId, checked } = body;

  if (!blockId || typeof blockId !== 'string') {
    return res.status(400).json({ error: 'invalid_block_id', message: 'Falta block_id' });
  }
  if (typeof checked !== 'boolean') {
    return res.status(400).json({ error: 'invalid_checked', message: 'checked debe ser booleano' });
  }

  try {
    await setToDoChecked(blockId, checked);
    return res.status(200).json({ ok: true, checked });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Error desconocido';
    return res.status(500).json({ error: 'internal_error', message });
  }
}
