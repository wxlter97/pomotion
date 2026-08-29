/**
 * Migración one-off: vuelca los datos de la página de Notion actual a la
 * base de Turso (tabla `tasks` / `work_sessions` / `recurring_rules`).
 *
 *   npm run migrate:notion -- --user <email> --dry-run
 *   npm run migrate:notion -- --user <email>
 *
 * Flags:
 *   --user <email>   requerido; el usuario (ya logueado con Google) al que
 *                    se le atribuyen los datos.
 *   --dry-run        solo cuenta, no escribe.
 *   --from <YYYY-MM-DD>  solo semanas que empiezan en/después de esa fecha.
 *   --force          migrar aunque el usuario ya tenga tareas (puede duplicar).
 *
 * Requiere en el `.env`: NOTION_TOKEN + NOTION_INDEX_PAGE_ID (y
 * NOTION_FILES_INDEX_PAGE_ID si usás varios archivos) + TURSO_DATABASE_URL.
 * Después de esta migración, la Fase 5 borra todo el código de Notion.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import type { InValue } from '@libsql/client';
import { getDb } from '../api/_lib/db.js';
import { listBlockChildren } from '../api/_lib/notionClient.js';
import {
  groupBlocksByWeek,
  groupPositionedBlocksByDay,
  expandColumns,
  isRecurringHeadingLabel,
  notionStore,
  readSessions,
} from '../api/_lib/notionStore.js';
import { resolveActivePageId, resolveFiles } from '../api/_lib/notionPage.js';
import { addDaysToDate, parseWeekRange, plainText } from '../api/_lib/parse.js';
import { weekdayOffset } from '../api/_lib/weekModel.js';

type PlannedTask = {
  id: string;
  name: string;
  date: string;
  done: boolean;
  order: number;
  file: string | null;
  sessions: { durationSeconds: number; start: string; end: string }[];
};
type PlannedRule = { name: string; file: string | null };
type Plan = { tasks: PlannedTask[]; rules: PlannedRule[]; skipped: string[] };

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

async function collectFromNotion(opts: { from?: string }): Promise<Plan> {
  const files = await resolveFiles();
  const targets =
    files.length > 0
      ? files.map((f) => ({ id: f.id as string | undefined, label: f.label as string | null }))
      : [{ id: undefined, label: null as string | null }];

  const tasks: PlannedTask[] = [];
  const rules: PlannedRule[] = [];
  const skipped: string[] = [];

  for (const target of targets) {
    const pageId = await resolveActivePageId(target.id);
    const groups = groupBlocksByWeek(await listBlockChildren(pageId));

    for (const group of groups) {
      if (isRecurringHeadingLabel(group.label)) continue;
      const range = group.range ?? parseWeekRange(group.label);
      if (!range || range.start > range.end) {
        skipped.push(`semana "${group.label}" (rango no parseable)`);
        continue;
      }
      if (opts.from && range.start < opts.from) continue;

      const positioned = await expandColumns(group.blocks, pageId);
      const { dayOrder, dayBlocks } = groupPositionedBlocksByDay(positioned);
      let weekTaskCount = 0;

      for (const day of dayOrder) {
        const offset = weekdayOffset(day);
        if (offset == null) {
          skipped.push(`día "${day}" en "${group.label}" (no laboral)`);
          continue;
        }
        const date = addDaysToDate(range.start, offset);
        const todos = dayBlocks.get(day) ?? [];
        for (let i = 0; i < todos.length; i++) {
          const block = todos[i];
          const content = block.to_do as { rich_text?: { plain_text?: string }[]; checked?: boolean };
          const name = plainText(content?.rich_text);
          if (!name) continue;
          const sessions = await readSessions(block);
          tasks.push({
            id: crypto.randomUUID(),
            name,
            date,
            done: Boolean(content?.checked),
            order: i,
            file: target.label,
            sessions: sessions.map((s) => ({
              durationSeconds: s.durationSeconds,
              start: s.start,
              end: s.end,
            })),
          });
          weekTaskCount++;
        }
      }
      console.log(`  ${target.label ?? '(archivo único)'} · ${group.label}: ${weekTaskCount} tareas`);
    }

    const recurring = await notionStore.listRecurringTasks(target.id);
    for (const t of recurring.tasks) rules.push({ name: t.text, file: target.label });
  }

  return { tasks, rules, skipped };
}

async function writeToTurso(userId: string, plan: Plan): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const stmts: { sql: string; args: InValue[] }[] = [];

  for (const t of plan.tasks) {
    stmts.push({
      sql: `INSERT INTO tasks (id, user_id, name, date, done, "order", file, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [t.id, userId, t.name, t.date, t.done ? 1 : 0, t.order, t.file, now, now],
    });
    for (const s of t.sessions) {
      stmts.push({
        sql: `INSERT INTO work_sessions (id, user_id, task_id, duration_sec, start_hhmm, end_hhmm, date, file, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [crypto.randomUUID(), userId, t.id, s.durationSeconds, s.start, s.end, t.date, t.file, now],
      });
    }
  }
  for (const r of plan.rules) {
    stmts.push({
      sql: `INSERT INTO recurring_rules (id, user_id, name, file, weekdays, active, created_at)
            VALUES (?, ?, ?, ?, '1,2,3,4,5', 1, ?)`,
      args: [crypto.randomUUID(), userId, r.name, r.file, now],
    });
  }

  for (let i = 0; i < stmts.length; i += 200) {
    await db.batch(stmts.slice(i, i + 200), 'write');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const email = flag(args, '--user');
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const from = flag(args, '--from');

  if (!email) {
    console.error('Uso: npm run migrate:notion -- --user <email> [--dry-run] [--from YYYY-MM-DD] [--force]');
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const userRow = (
    await db.execute({ sql: 'SELECT id FROM users WHERE lower(email) = lower(?)', args: [email] })
  ).rows[0];
  if (!userRow) {
    console.error(`No hay un usuario con email "${email}" en Turso. Iniciá sesión con Google al menos una vez.`);
    process.exitCode = 1;
    return;
  }
  const userId = String(userRow.id);

  const existing = Number(
    (await db.execute({ sql: 'SELECT count(*) AS c FROM tasks WHERE user_id = ?', args: [userId] })).rows[0]
      .c
  );
  if (existing > 0 && !force) {
    console.error(`El usuario ya tiene ${existing} tareas en Turso. Usá --force para migrar igual (puede duplicar).`);
    process.exitCode = 1;
    return;
  }

  console.log('Leyendo Notion…\n');
  const plan = await collectFromNotion({ from });
  const sessionCount = plan.tasks.reduce((n, t) => n + t.sessions.length, 0);

  console.log(
    `\nPlan: ${plan.tasks.length} tareas · ${sessionCount} sesiones · ${plan.rules.length} reglas recurrentes`
  );
  if (plan.skipped.length > 0) {
    console.log(`\nSalteado (${plan.skipped.length}):`);
    for (const s of plan.skipped) console.log(`  ${s}`);
  }

  if (dryRun) {
    console.log('\n(--dry-run: no se escribió nada)');
    return;
  }

  console.log('\nEscribiendo en Turso…');
  await writeToTurso(userId, plan);
  console.log('✔ Migración completa.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
