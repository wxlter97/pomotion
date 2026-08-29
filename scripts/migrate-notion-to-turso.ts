/**
 * Migración one-off: vuelca los datos de Notion a la base de Turso
 * (tablas `tasks` / `work_sessions` / `recurring_rules`).
 *
 *   npm run migrate:notion -- --user <email> --dry-run
 *   npm run migrate:notion -- --user <email>
 *
 * Flags:
 *   --user <email>      requerido; el usuario (ya logueado con Google) al que
 *                       se le atribuyen los datos.
 *   --dry-run           solo cuenta, no escribe.
 *   --from <YYYY-MM-DD>  solo semanas que empiezan en/después de esa fecha.
 *   --force             migrar aunque el usuario ya tenga tareas.
 *   --page <ids>        una o varias páginas de Notion (IDs o URLs, separadas
 *                       por coma) a leer directamente, salteando el índice.
 *                       Para páginas semanales viejas / archivadas.
 *   --file <etiqueta>   etiqueta de archivo para las tareas de --page
 *                       (default: sin archivo). Ej. --file "Trabajo" las
 *                       mezcla con tu Trabajo actual; --file "Archivo 2025"
 *                       las deja como archivo aparte en el selector.
 *
 * Sin --page: lee la(s) página(s) activa(s) del índice (resolveFiles /
 * resolveActivePageId) y sus recurrentes.
 *
 * Requiere en el `.env`: NOTION_TOKEN (+ NOTION_INDEX_PAGE_ID /
 * NOTION_FILES_INDEX_PAGE_ID salvo que uses --page) + TURSO_DATABASE_URL.
 * La página que pases con --page tiene que estar compartida con la
 * integración de Notion. Fase 5 borra todo el código de Notion.
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
import { addDaysToDate, extractNotionPageId, parseWeekRange, plainText } from '../api/_lib/parse.js';
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

/** Lee una página semanal (activa o archivada) y agrega sus tareas al plan. */
async function collectPage(
  pageId: string,
  fileLabel: string | null,
  opts: { from?: string },
  out: Plan
): Promise<void> {
  const groups = groupBlocksByWeek(await listBlockChildren(pageId));

  for (const group of groups) {
    if (isRecurringHeadingLabel(group.label)) continue;
    const range = group.range ?? parseWeekRange(group.label);
    if (!range || range.start > range.end) {
      out.skipped.push(`semana "${group.label}" (rango no parseable)`);
      continue;
    }
    if (opts.from && range.start < opts.from) continue;

    const positioned = await expandColumns(group.blocks, pageId);
    const { dayOrder, dayBlocks } = groupPositionedBlocksByDay(positioned);
    let count = 0;

    for (const day of dayOrder) {
      const offset = weekdayOffset(day);
      if (offset == null) {
        out.skipped.push(`día "${day}" en "${group.label}" (no laboral)`);
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
        out.tasks.push({
          id: crypto.randomUUID(),
          name,
          date,
          done: Boolean(content?.checked),
          order: i,
          file: fileLabel,
          sessions: sessions.map((s) => ({
            durationSeconds: s.durationSeconds,
            start: s.start,
            end: s.end,
          })),
        });
        count++;
      }
    }
    console.log(`  ${fileLabel ?? '(sin archivo)'} · ${group.label}: ${count} tareas`);
  }
}

async function collectFromNotion(opts: {
  from?: string;
  pages?: string[];
  file?: string | null;
}): Promise<Plan> {
  const out: Plan = { tasks: [], rules: [], skipped: [] };

  if (opts.pages && opts.pages.length > 0) {
    for (const pageId of opts.pages) {
      await collectPage(pageId, opts.file ?? null, opts, out);
    }
    return out;
  }

  const files = await resolveFiles();
  const targets =
    files.length > 0
      ? files.map((f) => ({ id: f.id as string | undefined, label: f.label as string | null }))
      : [{ id: undefined, label: null as string | null }];

  for (const target of targets) {
    await collectPage(await resolveActivePageId(target.id), target.label, opts, out);
    const recurring = await notionStore.listRecurringTasks(target.id);
    for (const t of recurring.tasks) out.rules.push({ name: t.text, file: target.label });
  }
  return out;
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
  const fileLabel = flag(args, '--file') ?? null;
  const pagesRaw = flag(args, '--page');
  const pages = pagesRaw
    ? pagesRaw
        .split(',')
        .map((s) => extractNotionPageId(s.trim()) ?? s.trim())
        .filter((s) => s.length > 0)
    : undefined;

  if (!email) {
    console.error(
      'Uso: npm run migrate:notion -- --user <email> [--dry-run] [--from YYYY-MM-DD] [--force] [--page <ids> --file <etiqueta>]'
    );
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
    console.error(`El usuario ya tiene ${existing} tareas en Turso. Usá --force para migrar igual.`);
    process.exitCode = 1;
    return;
  }

  console.log(pages ? `Leyendo ${pages.length} página(s) de Notion…\n` : 'Leyendo Notion…\n');
  const plan = await collectFromNotion({ from, pages, file: fileLabel });
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
