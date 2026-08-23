import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth.js';
import { appendBlockChildren, deleteBlock, updateToDo } from './_lib/notion.js';

async function handleUpdate(req: VercelRequest, res: VercelResponse) {
  const body = (req.body ?? {}) as { block_id?: string; checked?: boolean; text?: string };
  const { block_id: blockId, checked, text } = body;

  if (!blockId || typeof blockId !== 'string') {
    return res.status(400).json({ error: 'invalid_block_id', message: 'Falta block_id' });
  }
  if (checked === undefined && text === undefined) {
    return res.status(400).json({ error: 'nothing_to_update', message: 'Nada que actualizar' });
  }
  if (checked !== undefined && typeof checked !== 'boolean') {
    return res.status(400).json({ error: 'invalid_checked', message: 'checked debe ser booleano' });
  }

  let trimmedText: string | undefined;
  if (text !== undefined) {
    trimmedText = typeof text === 'string' ? text.trim() : '';
    if (!trimmedText) {
      return res.status(400).json({ error: 'invalid_text', message: 'El texto no puede estar vacío' });
    }
  }

  await updateToDo(blockId, { checked, text: trimmedText });
  return res.status(200).json({ ok: true, checked, text: trimmedText });
}

async function handleCreate(req: VercelRequest, res: VercelResponse) {
  const body = (req.body ?? {}) as { container_id?: string; after_block_id?: string; text?: string };
  const { container_id: containerId, after_block_id: afterBlockId, text } = body;

  if (!containerId || typeof containerId !== 'string') {
    return res.status(400).json({ error: 'invalid_container_id', message: 'Falta container_id' });
  }
  if (!afterBlockId || typeof afterBlockId !== 'string') {
    return res.status(400).json({ error: 'invalid_after_block_id', message: 'Falta after_block_id' });
  }
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) {
    return res.status(400).json({ error: 'invalid_text', message: 'El texto no puede estar vacío' });
  }

  const result = (await appendBlockChildren(
    containerId,
    [{ to_do: { rich_text: [{ type: 'text', text: { content: trimmed } }], checked: false } }],
    afterBlockId
  )) as { results?: { id?: string }[] };
  const blockId = result?.results?.[0]?.id;
  if (!blockId) {
    return res.status(502).json({ error: 'notion_no_id', message: 'Notion no devolvió el id del bloque creado' });
  }

  return res.status(200).json({ ok: true, task: { blockId, text: trimmed, checked: false } });
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
    if (req.method === 'PATCH') return await handleUpdate(req, res);
    if (req.method === 'POST') return await handleCreate(req, res);
    if (req.method === 'DELETE') return await handleDelete(req, res);
    res.setHeader('Allow', 'PATCH, POST, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Error desconocido';
    return res.status(500).json({ error: 'internal_error', message });
  }
}
