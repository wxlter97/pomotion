const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function getToken(): string {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error('NOTION_TOKEN no está configurada');
  }
  return token;
}

async function notionFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API respondió ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

export type NotionRichText = {
  type?: string;
  text?: { content: string; link?: { url: string } | null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mention?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  equation?: any;
  annotations?: Record<string, unknown>;
  plain_text?: string;
  href?: string | null;
};

export type NotionBlock = {
  id: string;
  type: string;
  has_children: boolean;
  [key: string]: unknown;
};

type ListChildrenResponse = {
  results: NotionBlock[];
  has_more: boolean;
  next_cursor: string | null;
};

/** Lista TODOS los hijos directos (no recursivo) de un bloque/página, paginando. */
export async function listBlockChildren(blockId: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) params.set('start_cursor', cursor);
    const data = await notionFetch<ListChildrenResponse>(
      `/blocks/${blockId}/children?${params.toString()}`
    );
    blocks.push(...data.results);
    cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

export async function appendBlockChildren(
  blockId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children: Record<string, any>[],
  after?: string
): Promise<unknown> {
  return notionFetch(`/blocks/${blockId}/children`, {
    method: 'PATCH',
    body: JSON.stringify(after ? { children, after } : { children }),
  });
}

/** Archiva (borra) un bloque — usado para quitar una sesión o tarea. */
export async function deleteBlock(blockId: string): Promise<unknown> {
  return notionFetch(`/blocks/${blockId}`, { method: 'DELETE' });
}

/** Marca/desmarca un bloque to_do, sin tocar su texto. */
export async function setToDoChecked(blockId: string, checked: boolean): Promise<unknown> {
  return notionFetch(`/blocks/${blockId}`, {
    method: 'PATCH',
    body: JSON.stringify({ to_do: { checked } }),
  });
}

/** Trae un bloque por su propio id (a diferencia de listBlockChildren, que lista sus HIJOS). */
export async function getBlock(blockId: string): Promise<NotionBlock> {
  return notionFetch<NotionBlock>(`/blocks/${blockId}`);
}

/**
 * Reconstruye un array rich_text leído de Notion a la forma que acepta al
 * crear/actualizar un bloque — allowlist explícita en vez de "restar"
 * campos, para no arrastrar campos de solo lectura (plain_text, href) al
 * volver a escribirlo (usado al recrear una tarea en otra posición).
 */
export function toRichTextRequest(items: NotionRichText[]): Record<string, unknown>[] {
  return items.map((item) => {
    const out: Record<string, unknown> = { type: item.type };
    if (item.type === 'text') out.text = item.text;
    else if (item.type === 'mention') out.mention = item.mention;
    else if (item.type === 'equation') out.equation = item.equation;
    if (item.annotations) out.annotations = item.annotations;
    return out;
  });
}
