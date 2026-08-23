import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from './_lib/auth.js';
import {
  appendBlockChildren,
  deleteBlock,
  getBlock,
  listBlockChildren,
  toRichTextRequest,
  type NotionRichText,
} from './_lib/notion.js';

/**
 * Notion no tiene un endpoint para "mover" un bloque de posición. La única
 * forma de reordenar es crear un bloque nuevo en la posición destino
 * (copiando texto, checked, y las sesiones registradas como hijos) y
 * borrar el original.
 *
 * Orden seguro para no perder datos si algo falla a la mitad:
 *   1. Leer el bloque original y sus hijos (sesiones).
 *   2. Crear el bloque nuevo en la posición destino.
 *   3. Copiar las sesiones al bloque nuevo — si esto falla, borrar el
 *      bloque nuevo recién creado (si no, queda un duplicado incompleto
 *      sin historial, peor que no haber hecho nada).
 *   4. Solo ahora, borrar el bloque original. Si justo este paso falla,
 *      el bloque nuevo ya tiene todo correcto — se responde OK con un
 *      aviso de que quedó un duplicado viejo, no como error.
 * Un fallo en los pasos 1-2 deja el original intacto (no-op seguro).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!requireAuth(req, res)) return;

  const body = (req.body ?? {}) as { block_id?: string; container_id?: string; after_block_id?: string };
  const { block_id: blockId, container_id: containerId, after_block_id: afterBlockId } = body;

  if (!blockId || typeof blockId !== 'string') {
    return res.status(400).json({ error: 'invalid_block_id', message: 'Falta block_id' });
  }
  if (!containerId || typeof containerId !== 'string') {
    return res.status(400).json({ error: 'invalid_container_id', message: 'Falta container_id' });
  }
  if (!afterBlockId || typeof afterBlockId !== 'string') {
    return res.status(400).json({ error: 'invalid_after_block_id', message: 'Falta after_block_id' });
  }
  if (afterBlockId === blockId) {
    return res.status(400).json({ error: 'invalid_after_block_id', message: 'No puede ir después de sí misma' });
  }

  try {
    const original = await getBlock(blockId);
    if (original.type !== 'to_do') {
      return res.status(400).json({ error: 'not_a_todo', message: 'El bloque no es una tarea' });
    }
    const originalToDo = original.to_do as { rich_text?: NotionRichText[]; checked?: boolean; color?: string };

    let childrenToCopy: Awaited<ReturnType<typeof listBlockChildren>> = [];
    if (original.has_children) {
      childrenToCopy = await listBlockChildren(blockId);
      const unsupported = childrenToCopy.find((c) => c.type !== 'paragraph');
      if (unsupported) {
        return res.status(409).json({
          error: 'unsupported_child_block',
          message: `Esta tarea tiene un bloque hijo de tipo "${unsupported.type}" que no se puede mover automáticamente. Ajústalo manualmente en Notion antes de reordenar.`,
        });
      }
    }

    const createResult = (await appendBlockChildren(
      containerId,
      [
        {
          to_do: {
            rich_text: toRichTextRequest(originalToDo.rich_text ?? []),
            checked: Boolean(originalToDo.checked),
            color: originalToDo.color ?? 'default',
          },
        },
      ],
      afterBlockId
    )) as { results?: { id?: string }[] };
    const newBlockId = createResult?.results?.[0]?.id;
    if (!newBlockId) {
      return res.status(502).json({ error: 'notion_no_id', message: 'Notion no devolvió el id del bloque nuevo' });
    }

    if (childrenToCopy.length > 0) {
      try {
        const childrenPayload = childrenToCopy.map((child) => ({
          paragraph: {
            rich_text: toRichTextRequest(
              ((child.paragraph as { rich_text?: NotionRichText[] } | undefined)?.rich_text) ?? []
            ),
          },
        }));
        await appendBlockChildren(newBlockId, childrenPayload);
      } catch (err) {
        try {
          await deleteBlock(newBlockId);
        } catch {
          // best-effort rollback — si esto también falla, queda un
          // duplicado a medias; se prioriza propagar el error original.
        }
        throw err;
      }
    }

    try {
      await deleteBlock(blockId);
    } catch (err) {
      console.error('task-reorder: se creó el reemplazo pero falló borrar el original', err);
      return res.status(200).json({ ok: true, newBlockId, warning: 'stale_original_not_deleted' });
    }

    return res.status(200).json({ ok: true, newBlockId });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Error desconocido';
    return res.status(500).json({ error: 'internal_error', message });
  }
}
