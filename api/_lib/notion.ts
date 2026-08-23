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

export type NotionRichText = { plain_text?: string };

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
  children: Record<string, any>[]
): Promise<unknown> {
  return notionFetch(`/blocks/${blockId}/children`, {
    method: 'PATCH',
    body: JSON.stringify({ children }),
  });
}

/** Archiva (borra) un bloque — usado para quitar una sesión mal registrada. */
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
