import type {
  Analytics,
  CalendarFeed,
  DayTemplate,
  DayTemplateItem,
  FileEntry,
  FocusHeatmap,
  GoalProgress,
  MonthSummary,
  RecurringRule,
  Session,
  Tag,
  Task,
  TaskPriority,
  TaskSearchResult,
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

// --- Admin: aprobación de usuarios ---

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  pictureUrl: string | null;
  approved: boolean;
  isAdmin: boolean;
  createdAt: string;
  lastSeenAt: string | null;
};

export function getAdminUsers() {
  return request<{ users: AdminUser[] }>('/api/auth/status?users=1');
}

export function setUserApproval(userId: string, approved: boolean) {
  return request<{ ok: true }>('/api/auth/status', {
    method: 'POST',
    body: JSON.stringify({ action: approved ? 'approve' : 'revoke', userId }),
  });
}

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

// --- Backup / restore ---

/** URL de descarga directa del backup completo (.json), navegación normal. */
export const backupDownloadUrl = '/api/tasks?export=1&download=1';

/** Restaura un backup. Solo funciona si la cuenta está vacía (409 si no). */
export function importBackup(backup: unknown) {
  return request<{ ok: true; imported: Record<string, number> }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ action: 'import', backup }),
  });
}

/** Busca tareas por texto en el nombre (todas las semanas + inbox del contexto). */
export function searchTasks(query: string, fileId?: string) {
  const params = new URLSearchParams({ search: query });
  if (fileId) params.set('file', fileId);
  return request<{ results: TaskSearchResult[] }>(`/api/tasks?${params.toString()}`);
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

/** Horas registradas por día en las últimas `weeks` semanas (heatmap de foco). */
export function getFocusHeatmap(weeks?: number, fileId?: string) {
  const params = new URLSearchParams();
  params.set('heatmap', '1');
  if (weeks) params.set('weeks', String(weeks));
  if (fileId) params.set('file', fileId);
  return request<FocusHeatmap>(`/api/tasks?${params.toString()}`);
}

/** Agregados del panel de analítica de las últimas `weeks` semanas. */
export function getAnalytics(weeks?: number, fileId?: string) {
  const params = new URLSearchParams();
  params.set('analytics', '1');
  if (weeks) params.set('weeks', String(weeks));
  if (fileId) params.set('file', fileId);
  return request<Analytics>(`/api/tasks?${params.toString()}`);
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

/** Crea una tarea sin fecha (inbox / backlog). */
export function createInboxTask(text: string, fileId?: string) {
  return request<{ ok: true; task: Task }>('/api/task', {
    method: 'POST',
    body: JSON.stringify({ text, file: fileId }),
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

/** Prioridad / notas / vencimiento / estimación. `null` en un campo lo limpia;
 *  omitirlo lo deja igual. */
export function updateTaskFields(
  id: string,
  fields: {
    priority?: TaskPriority | null;
    notes?: string | null;
    due?: string | null;
    estimateMinutes?: number | null;
    tagIds?: string[];
  }
) {
  const { estimateMinutes, tagIds, ...rest } = fields;
  const body: Record<string, unknown> = { id, ...rest };
  if (estimateMinutes !== undefined) body.estimate_min = estimateMinutes;
  if (tagIds !== undefined) body.tag_ids = tagIds;
  return request<{ ok: true }>('/api/task', { method: 'PATCH', body: JSON.stringify(body) });
}

// --- Etiquetas / proyectos ---

export function createTag(name: string, color: string) {
  return request<{ ok: true; tag: Tag }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ action: 'create_tag', name, color }),
  });
}

export function updateTag(id: string, fields: { name?: string; color?: string }) {
  return request<{ ok: true; tag: Tag }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ action: 'update_tag', id, ...fields }),
  });
}

export function deleteTag(id: string) {
  return request<{ ok: true }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ action: 'delete_tag', id }),
  });
}

// --- Plantillas de día ---

type TemplateItemInput = { name: string; priority?: DayTemplateItem['priority']; estimateMinutes?: number | null };

/** Crea una plantilla con ítems explícitos o como snapshot de un día. */
export function createDayTemplate(
  name: string,
  opts: { items?: TemplateItemInput[]; fromDate?: string; fileId?: string }
) {
  return request<{ ok: true; template: DayTemplate }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      action: 'create_template',
      name,
      items: opts.items,
      from_date: opts.fromDate,
      file: opts.fileId,
    }),
  });
}

export function updateDayTemplate(id: string, fields: { name?: string; items?: TemplateItemInput[] }) {
  return request<{ ok: true; template: DayTemplate }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ action: 'update_template', id, ...fields }),
  });
}

export function deleteDayTemplate(id: string) {
  return request<{ ok: true }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ action: 'delete_template', id }),
  });
}

/** Estampa la plantilla en `date` ('YYYY-MM-DD'). */
export function applyDayTemplate(id: string, date: string, fileId?: string) {
  return request<{ ok: true; added: number }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ action: 'apply_template', id, date, file: fileId }),
  });
}

// --- Metas ---

export function getGoals() {
  return request<{ goals: GoalProgress[] }>('/api/tasks?goals=1');
}

export function createGoal(targetMinutes: number, tagId: string | null, fileId?: string) {
  return request<{ ok: true; goal: GoalProgress }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ action: 'create_goal', target_minutes: targetMinutes, tag_id: tagId, file: fileId }),
  });
}

export function updateGoal(id: string, fields: { targetMinutes?: number; tagId?: string | null }) {
  const body: Record<string, unknown> = { action: 'update_goal', id };
  if (fields.targetMinutes !== undefined) body.target_minutes = fields.targetMinutes;
  if ('tagId' in fields) body.tag_id = fields.tagId;
  return request<{ ok: true; goal: GoalProgress }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function deleteGoal(id: string) {
  return request<{ ok: true }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ action: 'delete_goal', id }),
  });
}

// --- Calendarios iCal ---

export function getCalendarFeeds() {
  return request<{ feeds: CalendarFeed[] }>('/api/tasks?feeds=1');
}

export function createCalendarFeed(name: string, url: string, fileId: string | null) {
  return request<{ ok: true; feed: CalendarFeed }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ action: 'create_feed', name, url, file: fileId }),
  });
}

export function updateCalendarFeed(
  id: string,
  fields: { name?: string; enabled?: boolean; fileId?: string | null }
) {
  const body: Record<string, unknown> = { action: 'update_feed', id };
  if (fields.name !== undefined) body.name = fields.name;
  if (fields.enabled !== undefined) body.enabled = fields.enabled;
  if ('fileId' in fields) body.file = fields.fileId;
  return request<{ ok: true; feed: CalendarFeed }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function deleteCalendarFeed(id: string) {
  return request<{ ok: true }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ action: 'delete_feed', id }),
  });
}

export type SyncCalendarResult = {
  ok: true;
  syncedFeeds: number;
  added: number;
  updated: number;
  removed: number;
  changed: boolean;
};

/** Sincroniza los feeds vencidos (o uno puntual con `feedId`, ignorando el debounce). */
export function syncCalendarFeeds(feedId?: string) {
  return request<SyncCalendarResult>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ action: 'sync_feeds', feed_id: feedId }),
  });
}

export function deleteTask(id: string) {
  return request<{ ok: true }>('/api/task', { method: 'DELETE', body: JSON.stringify({ id }) });
}

/** Reordena / mueve una tarea. `date`: 'YYYY-MM-DD' para otro día, `null`
 *  para el inbox, omitido para no cambiar el día. `afterId` (o null = al
 *  inicio) para la posición dentro del día. */
export function moveTask(id: string, opts: { date?: string | null; afterId?: string | null }) {
  const body: Record<string, unknown> = { id, after_id: opts.afterId };
  if ('date' in opts) body.date = opts.date;
  return request<{ ok: true; id: string }>('/api/task-reorder', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Saca una tarea de la agenda: vuelve al inbox (sin fecha). */
export function moveTaskToInbox(id: string) {
  return moveTask(id, { date: null });
}

// --- Acciones en lote ---

export type BulkOp = 'complete' | 'reopen' | 'move' | 'inbox' | 'add_tag' | 'delete';

/** Aplica una acción a varias tareas. `date` para 'move', `tagId` para 'add_tag'. */
export function bulkTasks(op: BulkOp, ids: string[], opts?: { date?: string; tagId?: string }) {
  return request<{ ok: true; affected: number; skipped: number }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ action: 'bulk', op, ids, date: opts?.date, tag_id: opts?.tagId }),
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
  taskId: string;
  task: string;
  estimateMinutes: number | null;
  tagIds: string[];
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
  return request<{
    rows: ReportRow[];
    totalSeconds: number;
    estimatedMinutes: number;
    tags: Tag[];
  }>(`/api/report?${reportParams(from, to, fileId)}`);
}

/** URL de descarga directa del CSV (navegación normal del navegador — la
 *  cookie de sesión viaja sola y el header Content-Disposition fuerza la
 *  descarga). */
export function reportCsvUrl(from: string, to: string, fileId?: string) {
  return `/api/report?${reportParams(from, to, fileId, { format: 'csv' })}`;
}
