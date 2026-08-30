/**
 * Lógica de sincronización de calendarios: baja el .ics, lo parsea (ver
 * ical.ts) y planifica los cambios (crear / actualizar / borrar tareas)
 * comparando lo que dice el calendario con lo que ya hay en la DB para ese
 * feed. La aplicación de esos cambios contra Turso vive en sqliteStore.ts.
 *
 * Sync unidireccional: nunca se escribe de vuelta al calendario.
 */
import { dateTimeInTz } from './parse.js';
import { parseIcalEvents, type IcalEvent } from './ical.js';

/** Días hacia atrás / adelante de hoy que se materializan. */
export const SYNC_WINDOW_BACK_DAYS = 7;
export const SYNC_WINDOW_FWD_DAYS = 28;
/** No re-sincronizar un feed más seguido que esto (salvo "Sincronizar ahora"). */
export const SYNC_DEBOUNCE_MS = 10 * 60 * 1000;
/** Cortes defensivos al bajar el .ics. */
export const FETCH_TIMEOUT_MS = 12_000;
export const MAX_ICS_BYTES = 5 * 1024 * 1024;

/** Tarea que el calendario "quiere" que exista, ya en términos de la app. */
export type DesiredTask = {
  externalUid: string;
  name: string;
  /** 'YYYY-MM-DD' en la zona de la app. */
  date: string;
  /** Duración del evento en minutos (0 = no setear estimación). */
  estimateMin: number;
  /** "📅 09:00–10:30 · Sala" para las notas. */
  notes: string;
};

/** Fila de `tasks` de un feed, con lo necesario para decidir si se puede tocar. */
export type FeedTaskRow = {
  id: string;
  externalUid: string;
  name: string;
  date: string | null;
  externalDate: string | null;
  notes: string | null;
  estimateMin: number | null;
  done: boolean;
  hasSessions: boolean;
};

export type SyncPlan = {
  create: DesiredTask[];
  update: (DesiredTask & { id: string })[];
  /** ids de tareas a borrar (desaparecieron del feed y nadie las tocó). */
  remove: string[];
  /** ids de tareas a desvincular del feed (desaparecieron pero tienen historial). */
  orphan: string[];
};

export function syncWindow(today: Date): { start: Date; end: Date } {
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - SYNC_WINDOW_BACK_DAYS);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + SYNC_WINDOW_FWD_DAYS);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Convierte los eventos expandidos del .ics en el set de tareas deseado. */
export function desiredTasksFromEvents(events: IcalEvent[], timeZone: string): DesiredTask[] {
  const byUid = new Map<string, DesiredTask>();
  for (const ev of events) {
    const s = dateTimeInTz(ev.start, timeZone);
    const e = dateTimeInTz(ev.end, timeZone);
    const durMin = Math.round((ev.end.getTime() - ev.start.getTime()) / 60_000);
    const loc = ev.location ? ` · ${ev.location}` : '';
    byUid.set(ev.uid, {
      externalUid: ev.uid,
      name: ev.summary.slice(0, 500),
      date: s.date,
      estimateMin: durMin > 0 && durMin <= 24 * 60 ? durMin : 0,
      notes: `📅 ${s.time}–${e.time}${loc}`.slice(0, 500),
    });
  }
  return [...byUid.values()];
}

/** true si la tarea sigue "como la dejó el calendario" y se puede re-sincronizar. */
function untouched(row: FeedTaskRow): boolean {
  return !row.done && !row.hasSessions && row.date === row.externalDate;
}

function differs(row: FeedTaskRow, want: DesiredTask): boolean {
  return (
    row.name !== want.name ||
    row.date !== want.date ||
    row.externalDate !== want.date ||
    (row.notes ?? '') !== want.notes ||
    (row.estimateMin ?? 0) !== want.estimateMin
  );
}

/**
 * Reconciliación. `existing` debe venir ya acotado a la ventana (por
 * `external_date`), si no las tareas viejas se verían como "desaparecidas".
 */
export function planSync(desired: DesiredTask[], existing: FeedTaskRow[]): SyncPlan {
  const desiredByUid = new Map(desired.map((d) => [d.externalUid, d]));
  const existingByUid = new Map(existing.map((r) => [r.externalUid, r]));

  const plan: SyncPlan = { create: [], update: [], remove: [], orphan: [] };

  for (const want of desired) {
    const row = existingByUid.get(want.externalUid);
    if (!row) {
      plan.create.push(want);
    } else if (untouched(row) && differs(row, want)) {
      plan.update.push({ ...want, id: row.id });
    }
  }

  for (const row of existing) {
    if (desiredByUid.has(row.externalUid)) continue;
    if (untouched(row)) plan.remove.push(row.id);
    else plan.orphan.push(row.id);
  }

  return plan;
}

/** 'YYYY-MM-DD' de un `Date` en UTC (para acotar el rango de `external_date`). */
export function isoDateUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export type FetchIcalResult = { ok: true; text: string } | { ok: false; error: string };

/** Baja el .ics con timeout y tope de tamaño. `webcal://` se normaliza a https. */
export async function fetchIcalText(url: string): Promise<FetchIcalResult> {
  let target: URL;
  try {
    target = new URL(url.trim().replace(/^webcal:\/\//i, 'https://'));
  } catch {
    return { ok: false, error: 'La URL no es válida.' };
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return { ok: false, error: 'La URL debe ser http(s) o webcal.' };
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { Accept: 'text/calendar, text/plain, */*', 'User-Agent': 'pomotion-calendar-sync' },
    });
    if (!res.ok) return { ok: false, error: `El calendario respondió ${res.status}.` };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_ICS_BYTES) return { ok: false, error: 'El calendario es demasiado grande.' };
    const text = new TextDecoder('utf-8').decode(buf);
    if (!/BEGIN:VCALENDAR/i.test(text)) return { ok: false, error: 'La URL no devolvió un calendario iCal.' };
    return { ok: true, text };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'El calendario tardó demasiado en responder.' };
    }
    return { ok: false, error: 'No se pudo contactar al calendario.' };
  } finally {
    clearTimeout(timer);
  }
}

export { parseIcalEvents };
