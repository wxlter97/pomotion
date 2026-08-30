import { createClient } from '@libsql/client';
import { describe, expect, it } from 'vitest';
import { runMigrations } from './migrate.js';

const SCHEMA_TABLES = [
  'users',
  'auth_sessions',
  'oauth_state',
  'recurring_rules',
  'recurring_runs',
  'tasks',
  'work_sessions',
  'tags',
  'task_tags',
  'day_templates',
  'day_template_items',
  'goals',
  'calendar_feeds',
  'day_notes',
  'week_focus',
  'schema_migrations',
];

async function tableNames(db: ReturnType<typeof createClient>): Promise<Set<string>> {
  const res = await db.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
  return new Set(res.rows.map((r) => String(r.name)));
}

describe('runMigrations', () => {
  it('aplica 001_init y crea todas las tablas del schema', async () => {
    const db = createClient({ url: ':memory:' });
    const applied = await runMigrations(db, { log: () => {} });

    expect(applied).toContain('001_init.sql');
    expect(applied).toContain('002_recurring_runs.sql');
    expect(applied).toContain('003_day_templates.sql');
    expect(applied).toContain('004_goals.sql');
    expect(applied).toContain('005_calendar_feeds.sql');
    expect(applied).toContain('006_task_checklist.sql');
    expect(applied).toContain('007_day_notes.sql');
    expect(applied).toContain('008_monthly_recurrence.sql');
    expect(applied).toContain('009_week_focus.sql');
    const tables = await tableNames(db);
    for (const t of SCHEMA_TABLES) expect(tables.has(t), `falta la tabla ${t}`).toBe(true);
  });

  it('es idempotente: la segunda corrida no aplica nada', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrations(db, { log: () => {} });
    expect(await runMigrations(db, { log: () => {} })).toEqual([]);
  });

  it('--dry-run no toca la base', async () => {
    const db = createClient({ url: ':memory:' });
    expect(await runMigrations(db, { dryRun: true, log: () => {} })).toEqual([]);
    const tables = await tableNames(db);
    expect(tables.has('users')).toBe(false);
    expect(tables.has('schema_migrations')).toBe(true); // esta sí se crea siempre
  });

  it('las columnas clave de tasks existen (incluye los campos "horneados")', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrations(db, { log: () => {} });
    const cols = new Set(
      (await db.execute("SELECT name FROM pragma_table_info('tasks')")).rows.map((r) => String(r.name))
    );
    for (const c of ['user_id', 'date', 'done', 'order', 'file', 'priority', 'estimate_min', 'notes', 'due', 'recurring_rule_id', 'source', 'feed_id', 'external_uid', 'external_date', 'checklist']) {
      expect(cols.has(c), `falta tasks.${c}`).toBe(true);
    }
  });
});
