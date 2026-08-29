/**
 * Caché en memoria, por instancia de función serverless. Vive mientras la
 * función siga "caliente" — no persiste entre cold starts ni se comparte
 * entre endpoints distintos (cada archivo de /api es su propia función).
 *
 * Alcanza para lo que importa acá: colapsar cargas repetidas de la misma
 * vista semanal (el doble fetch al montar, ir y volver entre días/semanas)
 * y bajar la presión sobre el rate-limit de Notion. Las escrituras piden
 * `?fresh=1` para saltearla, y el cliente marca "pedí fresco la próxima"
 * después de cualquier mutación optimista (ver pendingFreshRef en App.tsx).
 */

type Entry = { value: unknown; expiresAt: number };

const MAX_ENTRIES = 50;
const store = new Map<string, Entry>();

export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function setCached(key: string, value: unknown, ttlMs: number): void {
  // Evicción FIFO simple si se llena (clave nueva; re-set de una existente
  // no cuenta porque Map.set mantiene la posición).
  if (!store.has(key) && store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Solo para tests. */
export function clearCache(): void {
  store.clear();
}
