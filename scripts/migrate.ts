/**
 * Runner de migraciones SQL para la base de datos (Turso / libSQL).
 *
 * Uso:
 *   npm run migrate            aplica las migraciones pendientes
 *   npm run migrate -- --dry-run   solo lista las pendientes
 *
 * Las migraciones son archivos `scripts/migrations/NNN_*.sql`, se aplican en
 * orden alfabético y se registran en la tabla `schema_migrations` para no
 * re-aplicarlas. Testeado en `scripts/migrate.test.ts` contra SQLite
 * in-memory.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from '@libsql/client';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export type MigrateOptions = { dryRun?: boolean; log?: (line: string) => void };

/** Aplica las migraciones que falten. Devuelve los nombres de archivo
 *  aplicados (vacío si no había pendientes o si `dryRun`). */
export async function runMigrations(db: Client, opts: MigrateOptions = {}): Promise<string[]> {
  const log = opts.log ?? ((line: string) => console.log(line));

  await db.execute(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)'
  );
  const applied = new Set(
    (await db.execute('SELECT name FROM schema_migrations')).rows.map((r) => String(r.name))
  );

  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => !applied.has(f));

  if (pending.length === 0) {
    log('Sin migraciones pendientes.');
    return [];
  }
  if (opts.dryRun) {
    log(`Pendientes (${pending.length}):`);
    for (const f of pending) log(`  ${f}`);
    return [];
  }

  for (const file of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await db.executeMultiple(sql);
    await db.execute({
      sql: 'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
      args: [file, new Date().toISOString()],
    });
    log(`✔ ${file}`);
  }
  return pending;
}

async function main(): Promise<void> {
  await import('dotenv/config');
  const { getDb } = await import('../api/_lib/db.js');
  await runMigrations(getDb(), { dryRun: process.argv.includes('--dry-run') });
}

// Correr solo si se invoca directo (no al importarlo desde un test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
