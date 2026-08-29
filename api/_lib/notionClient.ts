const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function getToken(): string {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error('NOTION_TOKEN no está configurada');
  }
  return token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function notionFetch<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
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
    // 429 (rate limit) y 5xx: reintento acotado. Notion limita a ~3 req/s;
    // esto sobre todo salva a la migración one-off (que hace cientos de GET).
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
      await sleep(waitMs);
      return notionFetch<T>(path, init, attempt + 1);
    }
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

/** Actualiza checked y/o el texto de un to_do (solo lo que se pase). */
export async function updateToDo(
  blockId: string,
  updates: { checked?: boolean; text?: string }
): Promise<unknown> {
  const to_do: Record<string, unknown> = {};
  if (updates.checked !== undefined) to_do.checked = updates.checked;
  if (updates.text !== undefined) {
    to_do.rich_text = [{ type: 'text', text: { content: updates.text } }];
  }
  return notionFetch(`/blocks/${blockId}`, {
    method: 'PATCH',
    body: JSON.stringify({ to_do }),
  });
}

/** Reemplaza el texto de un bloque paragraph — usado para editar una sesión ya registrada. */
export async function updateParagraphText(blockId: string, text: string): Promise<unknown> {
  return notionFetch(`/blocks/${blockId}`, {
    method: 'PATCH',
    body: JSON.stringify({ paragraph: { rich_text: [{ type: 'text', text: { content: text } }] } }),
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
