/**
 * Cliente de la base de datos (Turso / libSQL). Reemplaza a Notion como
 * almacén — ver ROADMAP.md.
 *
 * Singleton por instancia de función serverless (igual patrón que la caché
 * en apiCache.ts). Los tests inyectan su propio cliente `:memory:` con
 * `setDb`.
 */
import { createClient, type Client } from '@libsql/client';

let cached: Client | undefined;

/** Cliente libSQL configurado desde el entorno (`TURSO_DATABASE_URL`,
 *  `TURSO_AUTH_TOKEN`). Lanza si falta la URL. */
export function getDb(): Client {
  if (cached) return cached;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error('TURSO_DATABASE_URL no está configurada');
  }
  cached = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return cached;
}

/** Solo para tests / scripts: fija el cliente activo (ej. uno `:memory:`). */
export function setDb(client: Client): void {
  cached = client;
}

/** Solo para tests. */
export function resetDb(): void {
  cached = undefined;
}
