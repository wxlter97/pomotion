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

import googleCallbackHandler from '../api/auth/google/callback';
import googleStartHandler from '../api/auth/google/start';
import authLogoutHandler from '../api/auth/logout';
import authStatusHandler from '../api/auth/status';
import filesHandler from '../api/files';
import recurringHandler from '../api/recurring';
import reportHandler from '../api/report';
import sessionHandler from '../api/session';
import taskHandler from '../api/task';
import taskReorderHandler from '../api/task-reorder';
import tasksHandler from '../api/tasks';

type Handler = (req: VercelRequest, res: VercelResponse) => unknown | Promise<unknown>;

const routes: Record<string, Handler> = {
  '/api/auth/google/start': googleStartHandler as Handler,
  '/api/auth/google/callback': googleCallbackHandler as Handler,
  '/api/auth/status': authStatusHandler as Handler,
  '/api/auth/logout': authLogoutHandler as Handler,
  '/api/tasks': tasksHandler as Handler,
  '/api/session': sessionHandler as Handler,
  '/api/task-reorder': taskReorderHandler as Handler,
  '/api/task': taskHandler as Handler,
  '/api/files': filesHandler as Handler,
  '/api/report': reportHandler as Handler,
  '/api/recurring': recurringHandler as Handler,
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
