import type { TasksResponse } from './types';

export class UnauthorizedError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!res.ok) {
    let message = `Error ${res.status}`;
    try {
      const body = await res.json();
      message = body.message || body.error || message;
    } catch {
      // respuesta sin JSON, ignorar
    }
    if (res.status === 401) throw new UnauthorizedError(message);
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export function login(password: string) {
  return request<{ ok: true }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export function logout() {
  return request<{ ok: true }>('/api/logout', { method: 'POST' });
}

export function getTasks(day?: string) {
  const query = day ? `?day=${encodeURIComponent(day)}` : '';
  return request<TasksResponse>(`/api/tasks${query}`);
}

export function postSession(payload: {
  block_id: string;
  duration_minutes: number;
  start_time: string;
  end_time: string;
}) {
  return request<{ ok: true; session: { durationMinutes: number; start: string; end: string } }>(
    '/api/session',
    { method: 'POST', body: JSON.stringify(payload) }
  );
}
