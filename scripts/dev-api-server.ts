/**
 * Servidor local SOLO para desarrollo: monta los mismos handlers de /api
 * (los que Vercel despliega como funciones serverless) sobre un servidor
 * http plano, sin necesitar `vercel dev` ni una cuenta de Vercel logueada.
 *
 * No se usa en producción — ahí Vercel ejecuta `api/[...path].ts`, que
 * enruta con la misma tabla (`api/_routes/routes.ts`). Esto es solo un
 * adaptador mínimo de req/res para probar localmente. Uso: `npm run dev:api` (ver vite.config.ts para el proxy).
 */
import 'dotenv/config';
import http from 'node:http';
import { URL } from 'node:url';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { routes } from '../api/_routes/routes';

const PORT = Number(process.env.API_PORT) || 3000;

async function readRawBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(raw: string): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const handler = routes[url.pathname];
  if (!handler) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  const hasBody =
    req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT' || req.method === 'DELETE';
  // `rawBody` imita lo que el webhook de Wompi necesita en producción (la
  // firma HMAC se calcula sobre el cuerpo tal cual llegó).
  const rawBody = hasBody ? await readRawBody(req) : undefined;
  const body = rawBody !== undefined ? parseJson(rawBody) : undefined;

  const vercelReq = Object.assign(req, { query, body, rawBody }) as unknown as VercelRequest;

  let statusCode = 200;
  const vercelRes = {
    setHeader: (name: string, value: string | string[]) => {
      res.setHeader(name, value);
      return vercelRes;
    },
    getHeader: (name: string) => res.getHeader(name),
    status(code: number) {
      statusCode = code;
      return vercelRes;
    },
    json(payload: unknown) {
      res.statusCode = statusCode;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
      return vercelRes;
    },
    send(body: unknown) {
      res.statusCode = statusCode;
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
      return vercelRes;
    },
    redirect(code: number, location?: string) {
      const [status, url] = typeof code === 'number' ? [code, location] : [302, code as unknown as string];
      res.statusCode = status;
      res.setHeader('Location', url ?? '/');
      res.end();
      return vercelRes;
    },
  } as unknown as VercelResponse;

  try {
    await handler(vercelReq, vercelRes);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'internal_error',
          message: err instanceof Error ? err.message : 'Error desconocido',
        })
      );
    }
  }
});

server.listen(PORT, () => {
  console.log(`[pomotion] API dev server escuchando en http://localhost:${PORT}`);
});
