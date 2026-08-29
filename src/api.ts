import type {
  FileEntry,
  MonthSummary,
  RecurringRule,
  Session,
  Task,
  TasksResponse,
} from './types';

export class UnauthorizedError extends Error {}
/** La sesión existe pero la cuenta todavía no está aprobada (403). */
export class PendingApprovalError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!res.ok) {
    let message = `Error ${res.status}`;
    let code: string | undefined;
    try {
      const body = await res.json();
      message = body.message || body.error || message;
      code = typeof body.error === 'string' ? body.error : undefined;
    } catch {
      // respuesta sin JSON, ignorar
    }
    if (res.status === 401) throw new UnauthorizedError(message);
    if (res.status === 403 && code === 'pending_approval') throw new PendingApprovalError(message);
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export type AuthUser = {
  email: string;
  name: string | null;
  pictureUrl: string | null;
  isAdmin: boolean;
};
export type AuthStatus = { authed: false } | { authed: true; approved: boolean; user: AuthUser };

export function getAuthStatus() {
  return request<AuthStatus>('/api/auth/status');
}

/** URL a la que navega el botón "Continuar con Google". */
export const googleLoginUrl = '/api/auth/google/start';

export function logout() {
  return request<{ ok: true }>('/api/auth/logout', { method: 'POST' });
}

export function getFiles() {
  return request<{ files: FileEntry[] }>('/api/files');
}

export function getTasks(day?: string, week?: string, fileId?: string) {
  const params = new URLSearchParams();
  if (day) params.set('day', day);
  if (week) params.set('week', week);
  if (fileId) params.set('file', fileId);
  const query = params.toString();
  return request<TasksResponse>(`/api/tasks${query ? `?${query}` : ''}`);
}

/** Resumen del mes "YYYY-MM" (tareas + horas por día) para el calendario. */
export function getMonthSummary(month?: string, fileId?: string) {
  const params = new URLSearchParams();
  // Siempre presente (aunque vacío) para que el endpoint sirva el resumen
  // del mes y no la vista semanal; vacío = mes en curso del server.
  params.set('month', month ?? '');
  if (fileId) params.set('file', fileId);
  return request<MonthSummary>(`/api/tasks?${params.toString()}`);
}

// --- Tareas ---

/** Mueve a hoy las tareas pendientes (sin sesiones) de días pasados. */
export function carryOverToToday(fileId?: string) {
  return request<{ ok: true; moved: number }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ action: 'carry_over', file: fileId }),
  });
}

export function createTask(date: string, text: string, fileId?: string, afterId?: string | null) {
  return request<{ ok: true; task: Task }>('/api/task', {
    method: 'POST',
    body: JSON.stringify({ date, text, file: fileId, after_id: afterId }),
  });
}

export function updateTaskDone(id: string, done: boolean) {
  return request<{ ok: true; done: boolean }>('/api/task', {
    method: 'PATCH',
    body: JSON.stringify({ id, done }),
  });
}

export function updateTaskText(id: string, text: string) {
  return request<{ ok: true; text: string }>('/api/task', {
    method: 'PATCH',
    body: JSON.stringify({ id, text }),
  });
}

export function deleteTask(id: string) {
  return request<{ ok: true }>('/api/task', { method: 'DELETE', body: JSON.stringify({ id }) });
}

/** Reordena / mueve una tarea. `date` para moverla a otro día; `afterId`
 *  (o null = al inicio) para la posición dentro del día. */
export function moveTask(id: string, opts: { date?: string; afterId?: string | null }) {
  return request<{ ok: true; id: string }>('/api/task-reorder', {
    method: 'POST',
    body: JSON.stringify({ id, date: opts.date, after_id: opts.afterId }),
  });
}

// --- Sesiones ---

export function postSession(payload: {
  task_id: string;
  duration_seconds: number;
  start_time: string;
  end_time: string;
}) {
  return request<{ ok: true; session: Session }>('/api/session', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function postManualSession(taskId: string, durationSeconds: number, start: string, end: string) {
  return request<{ ok: true; session: Session }>('/api/session', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId, duration_seconds: durationSeconds, start, end }),
  });
}

export function updateSession(id: string, durationSeconds: number, start: string, end: string) {
  return request<{ ok: true; session: Session }>('/api/session', {
    method: 'PATCH',
    body: JSON.stringify({ id, duration_seconds: durationSeconds, start, end }),
  });
}

export function deleteSession(id: string) {
  return request<{ ok: true }>('/api/session', { method: 'DELETE', body: JSON.stringify({ id }) });
}

// --- Recurrentes ---

export function getRecurringRules() {
  return request<{ rules: RecurringRule[] }>('/api/recurring');
}

export function createRecurringRule(name: string, weekdays?: string) {
  return request<{ ok: true; rule: RecurringRule }>('/api/recurring', {
    method: 'POST',
    body: JSON.stringify({ action: 'create', name, weekdays }),
  });
}

export function updateRecurringRule(
  id: string,
  fields: { name?: string; weekdays?: string; active?: boolean }
) {
  return request<{ ok: true; rule: RecurringRule }>('/api/recurring', {
    method: 'POST',
    body: JSON.stringify({ action: 'update', id, ...fields }),
  });
}

export function deleteRecurringRule(id: string) {
  return request<{ ok: true }>('/api/recurring', {
    method: 'POST',
    body: JSON.stringify({ action: 'delete', id }),
  });
}

export function applyRecurring(week: string, fileId?: string) {
  return request<{ ok: true; added: number }>('/api/recurring', {
    method: 'POST',
    body: JSON.stringify({ action: 'apply', week, file: fileId }),
  });
}

// --- Reporte ---

export type ReportRow = {
  date: string;
  day: string;
  week: string;
  task: string;
  durationSeconds: number;
  start: string;
  end: string;
};

function reportParams(from: string, to: string, fileId?: string, extra?: Record<string, string>) {
  const params = new URLSearchParams({ from, to, ...extra });
  if (fileId) params.set('file', fileId);
  return params.toString();
}

export function getReport(from: string, to: string, fileId?: string) {
  return request<{ rows: ReportRow[]; totalSeconds: number }>(
    `/api/report?${reportParams(from, to, fileId)}`
  );
}

/** URL de descarga directa del CSV (navegación normal del navegador — la
 *  cookie de sesión viaja sola y el header Content-Disposition fuerza la
 *  descarga). */
export function reportCsvUrl(from: string, to: string, fileId?: string) {
  return `/api/report?${reportParams(from, to, fileId, { format: 'csv' })}`;
}
