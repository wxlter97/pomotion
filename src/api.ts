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

export function getTasks(day?: string, week?: string) {
  const params = new URLSearchParams();
  if (day) params.set('day', day);
  if (week) params.set('week', week);
  const query = params.toString();
  return request<TasksResponse>(`/api/tasks${query ? `?${query}` : ''}`);
}

export function postSession(payload: {
  block_id: string;
  duration_minutes: number;
  start_time: string;
  end_time: string;
}) {
  return request<{
    ok: true;
    session: { blockId?: string; durationMinutes: number; start: string; end: string };
  }>('/api/session', { method: 'POST', body: JSON.stringify(payload) });
}

export function deleteSession(blockId: string) {
  return request<{ ok: true }>('/api/session', {
    method: 'DELETE',
    body: JSON.stringify({ block_id: blockId }),
  });
}

export function postManualSession(blockId: string, durationMinutes: number, start: string, end: string) {
  return request<{
    ok: true;
    session: { blockId?: string; durationMinutes: number; start: string; end: string };
  }>('/api/session', {
    method: 'POST',
    body: JSON.stringify({ block_id: blockId, duration_minutes: durationMinutes, start, end }),
  });
}

export function updateSession(blockId: string, durationMinutes: number, start: string, end: string) {
  return request<{ ok: true; session: { durationMinutes: number; start: string; end: string } }>(
    '/api/session',
    {
      method: 'PATCH',
      body: JSON.stringify({ block_id: blockId, duration_minutes: durationMinutes, start, end }),
    }
  );
}

export function updateTaskChecked(blockId: string, checked: boolean) {
  return request<{ ok: true; checked: boolean }>('/api/task', {
    method: 'PATCH',
    body: JSON.stringify({ block_id: blockId, checked }),
  });
}

export function updateTaskText(blockId: string, text: string) {
  return request<{ ok: true; text: string }>('/api/task', {
    method: 'PATCH',
    body: JSON.stringify({ block_id: blockId, text }),
  });
}

export function createTask(containerId: string, afterBlockId: string, text: string) {
  return request<{ ok: true; task: { blockId: string; text: string; checked: boolean } }>('/api/task', {
    method: 'POST',
    body: JSON.stringify({ container_id: containerId, after_block_id: afterBlockId, text }),
  });
}

export function deleteTask(blockId: string) {
  return request<{ ok: true }>('/api/task', {
    method: 'DELETE',
    body: JSON.stringify({ block_id: blockId }),
  });
}

export function reorderTask(blockId: string, containerId: string, afterBlockId: string) {
  return request<{ ok: true; newBlockId: string; warning?: string }>('/api/task-reorder', {
    method: 'POST',
    body: JSON.stringify({ block_id: blockId, container_id: containerId, after_block_id: afterBlockId }),
  });
}

export function getNextWeekSuggestion() {
  return request<{ start: string; end: string; label: string }>('/api/week');
}

export function createWeek(start: string, end: string) {
  return request<{ ok: true; week: { label: string; start: string; end: string } }>('/api/week', {
    method: 'POST',
    body: JSON.stringify({ start, end }),
  });
}
