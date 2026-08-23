import { listBlockChildren, type NotionBlock } from './notion.js';
import { extractNotionPageId, plainText } from './parse.js';

/**
 * Lee la página índice permanente y extrae la referencia (URL o ID) a la
 * página semanal activa actualmente — así Walter puede rotar su plantilla
 * sin tocar env vars ni redeployar.
 */
export async function resolveActivePageId(): Promise<string> {
  const indexPageId = process.env.NOTION_INDEX_PAGE_ID;
  if (!indexPageId) {
    throw new Error('NOTION_INDEX_PAGE_ID no está configurada');
  }
  const blocks = await listBlockChildren(indexPageId);
  for (const block of blocks) {
    const content = block[block.type] as { rich_text?: { plain_text?: string }[] } | undefined;
    const text = plainText(content?.rich_text);
    if (!text) continue;
    const pageId = extractNotionPageId(text);
    if (pageId) return pageId;
  }
  throw new Error(
    'No se encontró ninguna referencia a una página semanal (URL o ID) en la página índice de Notion'
  );
}

/** Extrae el rich_text del "cuerpo" de un bloque, sin importar su tipo (heading_1, to_do, etc). */
export function richTextOf(block: NotionBlock): { plain_text?: string }[] | undefined {
  const content = block[block.type] as { rich_text?: { plain_text?: string }[] } | undefined;
  return content?.rich_text;
}
