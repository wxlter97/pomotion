/**
 * Único punto de entrada de `/api/*` en Vercel. `vercel.json` reescribe
 * `/api/<ruta>` a `/api/router?__path=<ruta>`: un `[...path].ts` no recoge
 * rutas con varios segmentos (`/api/auth/status`) en este proyecto, un
 * archivo plano + rewrite sí.
 * Hobby limita a 12 las
 * funciones serverless por deployment, así que en vez de un archivo por
 * endpoint hay UNA función que enruta a los handlers de `api/_routes/`
 * (el prefijo `_` hace que Vercel no los despliegue como funciones).
 *
 * Para agregar un endpoint: crear el handler en `_routes/` y registrarlo en
 * `routes.ts`. El servidor de desarrollo (`scripts/dev-api-server.ts`)
 * usa la misma tabla.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { routes } from './_routes/routes.js';

// El cuerpo se lee acá (crudo) para todos los endpoints: el webhook de pago
// necesita el texto exacto para validar la firma HMAC.
export const config = { api: { bodyParser: false } };

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rewritten = req.query?.__path;
  const pathname =
    typeof rewritten === 'string'
      ? `/api/${rewritten}`.replace(/\/$/, '')
      : new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/$/, '');
  // El parámetro es solo de enrutado: los handlers no deben verlo.
  if (req.query) delete req.query.__path;
  const route = routes[pathname];
  if (!route) return res.status(404).json({ error: 'not_found' });

  const hasBody = req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT' || req.method === 'DELETE';
  if (hasBody) {
    const raw = await readRawBody(req);
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = undefined;
    }
    Object.assign(req, { body, rawBody: raw });
  }
  return route(req, res);
}
