import { listBlockChildren, type NotionBlock } from './notionClient.js';
import { extractNotionPageId, plainText, stripNotionReference } from './parse.js';

/**
 * Lee la página índice (la del archivo activo, o la global si no se pasa
 * ninguna) y extrae la referencia (URL o ID) a la página semanal activa
 * actualmente — así Walter puede rotar su plantilla sin tocar env vars ni
 * redeployar.
 *
 * `fileIndexPageId` viene del selector de archivos (ver resolveFiles): cada
 * archivo tiene su propia página índice con la misma semántica que la
 * global. Sin `fileIndexPageId` (modo de un solo archivo, retrocompatible)
 * se usa `NOTION_INDEX_PAGE_ID`.
 */
export async function resolveActivePageId(fileIndexPageId?: string): Promise<string> {
  const indexPageId = fileIndexPageId || process.env.NOTION_INDEX_PAGE_ID;
  if (!indexPageId) {
    throw new Error('NOTION_INDEX_PAGE_ID no está configurada');
  }
  const blocks = await listBlockChildren(indexPageId);
  for (const block of blocks) {
    const text = plainText(richTextOf(block));
    if (!text) continue;
    const pageId = extractNotionPageId(text);
    if (pageId) return pageId;
  }
  throw new Error(
    'No se encontró ninguna referencia a una página semanal (URL o ID) en la página índice de Notion'
  );
}

export type FileEntry = { id: string; label: string };

/**
 * Lee la página raíz de archivos (opcional) y devuelve la lista de
 * archivos configurados — "Trabajo", "Casa", "Hábitos", etc. Cada bloque
 * de esa página es una etiqueta + un link/ID a la página índice PROPIA de
 * ese archivo (misma semántica que resolveActivePageId de arriba, un
 * nivel más arriba). El `id` de cada entrada es justamente el ID de esa
 * página índice — es lo que el cliente manda de vuelta como `file` en
 * cada request.
 *
 * Si `NOTION_FILES_INDEX_PAGE_ID` no está configurada, devuelve una lista
 * vacía: modo de un solo archivo implícito, retrocompatible con el
 * comportamiento anterior (el selector de archivos no se muestra).
 */
export async function resolveFiles(): Promise<FileEntry[]> {
  const filesRootId = process.env.NOTION_FILES_INDEX_PAGE_ID;
  if (!filesRootId) return [];

  const blocks = await listBlockChildren(filesRootId);
  const files: FileEntry[] = [];
  for (const block of blocks) {
    const text = plainText(richTextOf(block));
    if (!text) continue;
    const pageId = extractNotionPageId(text);
    if (!pageId) continue;
    const label = stripNotionReference(text) || text;
    files.push({ id: pageId, label });
  }
  return files;
}

/** Extrae el rich_text del "cuerpo" de un bloque, sin importar su tipo (heading_1, to_do, etc). */
export function richTextOf(block: NotionBlock): { plain_text?: string }[] | undefined {
  const content = block[block.type] as { rich_text?: { plain_text?: string }[] } | undefined;
  return content?.rich_text;
}
