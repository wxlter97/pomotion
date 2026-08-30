/**
 * Backup / restore manual del dataset de un usuario (ROADMAP §11).
 *
 * Un backup es un volcado tabla-por-tabla de todas las tablas de dominio,
 * sin `user_id` (se reinyecta al restaurar). Los ids originales se conservan
 * — el restore v1 solo corre en cuentas vacías, así que no hay colisiones y
 * se preservan todas las referencias (task_tags, work_sessions, goals…).
 *
 * Este módulo es puro: el manifiesto de tablas + la validación del payload.
 * El SQL vive en sqliteStore.ts.
 */
import { BadRequestError } from './errors.js';
import type { Backup, BackupValue } from './taskStore.js';

export type BackupTable = {
  table: string;
  /** Columnas a exportar / importar, en orden. `user_id` va aparte. */
  columns: readonly string[];
  /** true si la tabla tiene columna `user_id` propia. */
  hasUserId: boolean;
  /** WHERE para exportar solo las filas del usuario (un `?` = userId). */
  scopeWhere: string;
};

/**
 * Orden = orden de inserción seguro para las FKs (padres antes que hijos):
 * recurring_rules ← tasks; tags ← task_tags/goals; tasks ← task_tags/
 * work_sessions; day_templates ← day_template_items.
 */
export const BACKUP_TABLES: readonly BackupTable[] = [
  {
    table: 'recurring_rules',
    hasUserId: true,
    scopeWhere: 'user_id = ?',
    columns: ['id', 'name', 'file', 'weekdays', 'active', 'created_at', 'freq', 'monthdays', 'default_planned_start'],
  },
  {
    table: 'tags',
    hasUserId: true,
    scopeWhere: 'user_id = ?',
    columns: ['id', 'name', 'color'],
  },
  {
    table: 'tasks',
    hasUserId: true,
    scopeWhere: 'user_id = ?',
    columns: [
      'id', 'name', 'date', 'done', 'order', 'file', 'priority', 'estimate_min',
      'notes', 'due', 'recurring_rule_id', 'created_at', 'updated_at', 'source',
      'feed_id', 'external_uid', 'external_date', 'checklist', 'planned_start',
      'planned_minutes',
    ],
  },
  {
    table: 'task_tags',
    hasUserId: false,
    scopeWhere: 'task_id IN (SELECT id FROM tasks WHERE user_id = ?)',
    columns: ['task_id', 'tag_id'],
  },
  {
    table: 'work_sessions',
    hasUserId: true,
    scopeWhere: 'user_id = ?',
    columns: ['id', 'task_id', 'duration_sec', 'start_hhmm', 'end_hhmm', 'date', 'file', 'created_at'],
  },
  {
    table: 'day_templates',
    hasUserId: true,
    scopeWhere: 'user_id = ?',
    columns: ['id', 'name', 'file', 'created_at'],
  },
  {
    table: 'day_template_items',
    hasUserId: false,
    scopeWhere: 'template_id IN (SELECT id FROM day_templates WHERE user_id = ?)',
    columns: ['id', 'template_id', 'name', 'order', 'priority', 'estimate_min', 'planned_start'],
  },
  {
    table: 'goals',
    hasUserId: true,
    scopeWhere: 'user_id = ?',
    columns: ['id', 'tag_id', 'file', 'target_minutes', 'created_at'],
  },
  {
    table: 'calendar_feeds',
    hasUserId: true,
    scopeWhere: 'user_id = ?',
    columns: ['id', 'name', 'url', 'file', 'enabled', 'last_synced_at', 'last_error', 'created_at'],
  },
  {
    table: 'recurring_runs',
    hasUserId: true,
    scopeWhere: 'user_id = ?',
    columns: ['week_start', 'file_key', 'applied_at'],
  },
  {
    table: 'day_notes',
    hasUserId: true,
    scopeWhere: 'user_id = ?',
    columns: ['date', 'body', 'updated_at'],
  },
  {
    table: 'week_focus',
    hasUserId: true,
    scopeWhere: 'user_id = ?',
    columns: ['week_start', 'body', 'updated_at'],
  },
] as const;

/** Tablas con `id` propio (uuid) que hay que regenerar al restaurar, para no
 *  chocar con las filas del usuario que exportó (los ids son globales). */
const ID_TABLES = [
  'recurring_rules', 'tags', 'tasks', 'work_sessions', 'day_templates',
  'day_template_items', 'goals', 'calendar_feeds',
] as const;

/** Columnas que referencian el `id` de otra tabla: hay que remapearlas igual. */
const REF_COLUMNS: { table: string; column: string; target: string }[] = [
  { table: 'tasks', column: 'recurring_rule_id', target: 'recurring_rules' },
  { table: 'tasks', column: 'feed_id', target: 'calendar_feeds' },
  { table: 'task_tags', column: 'task_id', target: 'tasks' },
  { table: 'task_tags', column: 'tag_id', target: 'tags' },
  { table: 'work_sessions', column: 'task_id', target: 'tasks' },
  { table: 'day_template_items', column: 'template_id', target: 'day_templates' },
  { table: 'goals', column: 'tag_id', target: 'tags' },
];

/**
 * Regenera todos los ids del backup y reescribe las referencias, para que el
 * restore pueda convivir con la cuenta de origen en la misma DB. `genId` se
 * inyecta para testear. Una referencia a un id ausente se deja como está.
 */
export function remapIds(data: Backup['data'], genId: () => string): Backup['data'] {
  const maps: Record<string, Map<string, string>> = {};
  for (const table of ID_TABLES) {
    const m = new Map<string, string>();
    for (const row of data[table] ?? []) {
      if (typeof row.id === 'string') m.set(row.id, genId());
    }
    maps[table] = m;
  }

  const out: Backup['data'] = {};
  for (const { table } of BACKUP_TABLES) {
    const hasId = (ID_TABLES as readonly string[]).includes(table);
    const refs = REF_COLUMNS.filter((r) => r.table === table);
    out[table] = (data[table] ?? []).map((row) => {
      const next = { ...row };
      if (hasId && typeof next.id === 'string') {
        next.id = maps[table].get(next.id) ?? next.id;
      }
      for (const r of refs) {
        const v = next[r.column];
        if (typeof v === 'string') next[r.column] = maps[r.target].get(v) ?? v;
      }
      return next;
    });
  }
  return out;
}

/** Tablas que se chequean para decidir si una cuenta está "vacía". */
export const ACCOUNT_NONEMPTY_TABLES = [
  'tasks', 'tags', 'recurring_rules', 'day_templates', 'goals', 'calendar_feeds',
] as const;

const MAX_TOTAL_ROWS = 200_000;
/** SQLite tolera 999 parámetros por statement; dejamos margen. */
export const SQLITE_MAX_PARAMS = 900;

/**
 * Valida y normaliza un payload de restore. Ignora columnas desconocidas
 * (backups de una versión futura), rechaza tipos raros y payloads enormes.
 */
export function parseBackup(raw: unknown): Backup {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestError('invalid_backup', 'El archivo no es un backup de pomotion.');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== 'pomotion-backup') {
    throw new BadRequestError('invalid_backup', 'El archivo no es un backup de pomotion.');
  }
  if (obj.version !== 1) {
    throw new BadRequestError('unsupported_version', `Versión de backup no soportada: ${String(obj.version)}.`);
  }
  const data = obj.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new BadRequestError('invalid_backup', 'Al backup le falta la sección "data".');
  }

  const out: Backup['data'] = {};
  let total = 0;
  for (const { table, columns } of BACKUP_TABLES) {
    const rows = (data as Record<string, unknown>)[table];
    if (rows == null) {
      out[table] = [];
      continue;
    }
    if (!Array.isArray(rows)) {
      throw new BadRequestError('invalid_backup', `"${table}" debería ser una lista.`);
    }
    const allowed = new Set(columns);
    out[table] = rows.map((row, i) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new BadRequestError('invalid_backup', `Fila inválida en "${table}" (#${i + 1}).`);
      }
      const clean: Record<string, BackupValue> = {};
      for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
        if (!allowed.has(key)) continue;
        if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
          throw new BadRequestError('invalid_backup', `Valor inválido en "${table}.${key}" (#${i + 1}).`);
        }
        clean[key] = value as BackupValue;
      }
      return clean;
    });
    total += out[table].length;
    if (total > MAX_TOTAL_ROWS) {
      throw new BadRequestError('backup_too_large', 'El backup es demasiado grande para restaurar.');
    }
  }

  return {
    format: 'pomotion-backup',
    version: 1,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
    data: out,
  };
}

/**
 * Statements `INSERT` multi-fila (chunked por el tope de parámetros) para una
 * tabla. `extra` inyecta una columna fija a cada fila (ej. `user_id`).
 */
export function buildInserts(
  table: string,
  columns: readonly string[],
  rows: ReadonlyArray<Record<string, BackupValue>>,
  extra?: { column: string; value: BackupValue }
): { sql: string; args: BackupValue[] }[] {
  if (rows.length === 0) return [];
  const cols = extra ? [extra.column, ...columns] : [...columns];
  const quoted = cols.map((c) => `"${c}"`).join(', ');
  const rowPlaceholder = `(${cols.map(() => '?').join(', ')})`;
  const maxRows = Math.max(1, Math.floor(SQLITE_MAX_PARAMS / cols.length));

  const stmts: { sql: string; args: BackupValue[] }[] = [];
  for (let i = 0; i < rows.length; i += maxRows) {
    const chunk = rows.slice(i, i + maxRows);
    const args: BackupValue[] = [];
    for (const row of chunk) {
      if (extra) args.push(extra.value);
      for (const c of columns) args.push(row[c] ?? null);
    }
    stmts.push({
      sql: `INSERT INTO "${table}" (${quoted}) VALUES ${chunk.map(() => rowPlaceholder).join(', ')}`,
      args,
    });
  }
  return stmts;
}
