/**
 * Servidor local SOLO para desarrollo: monta los mismos handlers de /api
 * (los que Vercel despliega como funciones serverless) sobre un servidor
 * http plano, sin necesitar `vercel dev` ni una cuenta de Vercel logueada.
 *
 * No se usa en producción — ahí Vercel enruta cada archivo de /api
 * directamente. Esto es solo un adaptador mínimo de req/res para probar
 * localmente. Uso: `npm run dev:api` (ver vite.config.ts para el proxy).
 */
import 'dotenv/config';
import http from 'node:http';
import { URL } from 'node:url';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import loginHandler from '../api/login';
import logoutHandler from '../api/logout';
import sessionHandler from '../api/session';
import taskHandler from '../api/task';
import tasksHandler from '../api/tasks';

type Handler = (req: VercelRequest, res: VercelResponse) => unknown | Promise<unknown>;

const routes: Record<string, Handler> = {
  '/api/login': loginHandler as Handler,
  '/api/logout': logoutHandler as Handler,
  '/api/tasks': tasksHandler as Handler,
  '/api/session': sessionHandler as Handler,
  '/api/task': taskHandler as Handler,
};

const PORT = Number(process.env.API_PORT) || 3000;

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
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

  const body =
    req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT' || req.method === 'DELETE'
      ? await readJsonBody(req)
      : undefined;

  const vercelReq = Object.assign(req, { query, body }) as unknown as VercelRequest;

  let statusCode = 200;
  const vercelRes = {
    setHeader: (name: string, value: string) => {
      res.setHeader(name, value);
      return vercelRes;
    },
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
