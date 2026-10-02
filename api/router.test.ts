import { Readable } from 'node:stream';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { describe, expect, it, vi } from 'vitest';
import handler from './[...path].js';
import { routes } from './_routes/routes.js';

function fakeReq(method: string, url: string, body?: string): VercelRequest {
  return Object.assign(Readable.from(body ? [Buffer.from(body)] : []), { method, url }) as unknown as VercelRequest;
}

function fakeRes() {
  const res = { statusCode: 200, payload: undefined as unknown } as any;
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (p: unknown) => ((res.payload = p), res);
  return res as VercelResponse & { statusCode: number; payload: unknown };
}

describe('api/[...path] (enrutador único)', () => {
  it('registra todos los endpoints esperados', () => {
    expect(Object.keys(routes).sort()).toEqual([
      '/api/auth/google/callback',
      '/api/auth/google/start',
      '/api/auth/logout',
      '/api/auth/status',
      '/api/billing',
      '/api/files',
      '/api/habits',
      '/api/recurring',
      '/api/report',
      '/api/session',
      '/api/task',
      '/api/task-reorder',
      '/api/tasks',
    ]);
  });

  it('responde 404 en una ruta desconocida', async () => {
    const res = fakeRes();
    await handler(fakeReq('GET', '/api/nope'), res);
    expect(res.statusCode).toBe(404);
  });

  it('parsea el JSON y deja el cuerpo crudo para la firma del webhook', async () => {
    const spy = vi.fn();
    const original = routes['/api/files'];
    routes['/api/files'] = spy;
    try {
      const raw = '{"a": 1}';
      await handler(fakeReq('POST', '/api/files/?x=1', raw), fakeRes());
      const req = spy.mock.calls[0][0];
      expect(req.body).toEqual({ a: 1 });
      expect(req.rawBody).toBe(raw);
    } finally {
      routes['/api/files'] = original;
    }
  });

  it('JSON inválido llega como body undefined, sin romper', async () => {
    const spy = vi.fn();
    const original = routes['/api/files'];
    routes['/api/files'] = spy;
    try {
      await handler(fakeReq('POST', '/api/files', 'no json'), fakeRes());
      expect(spy.mock.calls[0][0].body).toBeUndefined();
      expect(spy.mock.calls[0][0].rawBody).toBe('no json');
    } finally {
      routes['/api/files'] = original;
    }
  });
});
