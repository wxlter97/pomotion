import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../scripts/migrate.js';
import { resetDb, setDb } from './db.js';
import { runWithUser } from './requestContext.js';
import { sqliteStore } from './sqliteStore.js';

const USER = 'user-1';
const OTHER = 'user-2';

async function seedUser(db: Client, id: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO users (id, email, google_sub, created_at) VALUES (?, ?, ?, ?)`,
    args: [id, `${id}@x.com`, `sub-${id}`, new Date().toISOString()],
  });
}

function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return runWithUser({ userId, isAdmin: false }, fn);
}

let db: Client;

beforeEach(async () => {
  db = createClient({ url: ':memory:' });
  await runMigrations(db, { log: () => {} });
  setDb(db);
  await seedUser(db, USER);
  await seedUser(db, OTHER);
  vi.useRealTimers();
});

describe('createTask + getWeekView', () => {
  it('crea tareas y las devuelve en el día correcto, ordenadas', async () => {
    await as(USER, async () => {
      await sqliteStore.createTask({ date: '2026-08-24', text: 'A' });
      await sqliteStore.createTask({ date: '2026-08-24', text: 'B' });
      await sqliteStore.createTask({ date: '2026-08-25', text: 'C' });
    });

    const view = await as(USER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' })
    );
    expect(view.tasks.map((t) => t.name)).toEqual(['A', 'B']);
    expect(view.days.map((d) => d.day)).toEqual(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']);
    expect(view.days[0].date).toBe('2026-08-24');
    expect(view.week).toBe('2026.08.24 - 2026.08.28');
    expect(view.previousWeekLabel).toBe('2026.08.17 - 2026.08.21');
    expect(view.nextWeekLabel).toBe('2026.08.31 - 2026.09.04');

    const martes = await as(USER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Martes' })
    );
    expect(martes.tasks.map((t) => t.name)).toEqual(['C']);
  });

  it('scopea por usuario', async () => {
    await as(USER, () => sqliteStore.createTask({ date: '2026-08-24', text: 'mía' }));
    const otherView = await as(OTHER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' })
    );
    expect(otherView.tasks).toHaveLength(0);
  });

  it('afterId ubica la tarea entre dos', async () => {
    const view = await as(USER, async () => {
      const a = await sqliteStore.createTask({ date: '2026-08-24', text: 'A' });
      const c = await sqliteStore.createTask({ date: '2026-08-24', text: 'C' });
      void c;
      await sqliteStore.createTask({ date: '2026-08-24', text: 'B', afterId: a.id });
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' });
    });
    expect(view.tasks.map((t) => t.name)).toEqual(['A', 'B', 'C']);
  });
});

describe('updateTask / deleteTask', () => {
  it('marca hecha y renombra', async () => {
    const view = await as(USER, async () => {
      const t = await sqliteStore.createTask({ date: '2026-08-24', text: 'x' });
      await sqliteStore.updateTask({ taskId: t.id, done: true });
      await sqliteStore.updateTask({ taskId: t.id, text: 'X renombrada' });
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' });
    });
    expect(view.tasks[0]).toMatchObject({ name: 'X renombrada', done: true });
  });

  it('deleteTask borra la tarea y sus sesiones', async () => {
    await as(USER, async () => {
      const t = await sqliteStore.createTask({ date: '2026-08-24', text: 'x' });
      await sqliteStore.logSession({ taskId: t.id, durationSeconds: 60, start: '09:00', end: '09:01' });
      await sqliteStore.deleteTask(t.id);
    });
    expect((await db.execute('SELECT count(*) c FROM tasks')).rows[0].c).toBe(0);
    expect((await db.execute('SELECT count(*) c FROM work_sessions')).rows[0].c).toBe(0);
  });

  it('no deja tocar la tarea de otro usuario', async () => {
    const t = await as(USER, () => sqliteStore.createTask({ date: '2026-08-24', text: 'x' }));
    await expect(as(OTHER, () => sqliteStore.updateTask({ taskId: t.id, done: true }))).rejects.toThrow();
  });
});

describe('updateTaskPosition (mover entre días)', () => {
  it('cambia la fecha de la tarea y de sus sesiones', async () => {
    await as(USER, async () => {
      const t = await sqliteStore.createTask({ date: '2026-08-24', text: 'x' });
      await sqliteStore.logSession({ taskId: t.id, durationSeconds: 1800, start: '09:00', end: '09:30' });
      await sqliteStore.updateTaskPosition({ taskId: t.id, date: '2026-08-27' });
    });
    const jueves = await as(USER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Jueves' })
    );
    expect(jueves.tasks).toHaveLength(1);
    expect(jueves.tasks[0].sessions[0].durationSeconds).toBe(1800);
    expect(jueves.dayTotalSeconds).toBe(1800);
  });
});

describe('carry-over', () => {
  it('trae a hoy las pendientes sin sesiones de días pasados', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z')); // hoy = miércoles 26

    const carried = await as(USER, async () => {
      await sqliteStore.createTask({ date: '2026-08-24', text: 'pendiente vieja' });
      const h = await sqliteStore.createTask({ date: '2026-08-24', text: 'ya hecha' });
      await sqliteStore.updateTask({ taskId: h.id, done: true });
      const cs = await sqliteStore.createTask({ date: '2026-08-25', text: 'con sesión' });
      await sqliteStore.logSession({ taskId: cs.id, durationSeconds: 60, start: '09:00', end: '09:01' });
      await sqliteStore.createTask({ date: '2026-08-28', text: 'futura' });
      await sqliteStore.createTask({ date: '2026-08-01', text: 'vieja abandonada' }); // >14 días
      return sqliteStore.carryOverToToday({});
    });
    expect(carried.moved).toBe(1);

    const view = await as(USER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Miércoles' })
    );
    expect(view.tasks.map((t) => t.name)).toEqual(['pendiente vieja']);
    expect(view.carryOverCount).toBe(0);

    // las otras no se movieron
    const lunes = await as(USER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' })
    );
    expect(lunes.tasks.map((t) => t.name)).toEqual(['ya hecha']);
    vi.useRealTimers();
  });
});

describe('getMonthSummary (vista mensual)', () => {
  it('resume tareas y horas por día del mes, solo días con actividad', async () => {
    const summary = await as(USER, async () => {
      const a = await sqliteStore.createTask({ date: '2026-08-03', text: 'A' });
      const b = await sqliteStore.createTask({ date: '2026-08-03', text: 'B' });
      await sqliteStore.updateTask({ taskId: b.id, done: true });
      await sqliteStore.logSession({ taskId: a.id, durationSeconds: 1800, start: '09:00', end: '09:30' });
      // día con sesión pero sin tarea creada ese día es imposible; día solo-tareas:
      await sqliteStore.createTask({ date: '2026-08-20', text: 'C' });
      // otro mes: no debe aparecer
      await sqliteStore.createTask({ date: '2026-09-01', text: 'D' });
      return sqliteStore.getMonthSummary({ month: '2026-08' });
    });

    expect(summary.month).toBe('2026-08');
    expect(summary.previousMonth).toBe('2026-07');
    expect(summary.nextMonth).toBe('2026-09');
    expect(summary.days).toEqual([
      { date: '2026-08-03', taskCount: 2, doneCount: 1, totalSeconds: 1800 },
      { date: '2026-08-20', taskCount: 1, doneCount: 0, totalSeconds: 0 },
    ]);
  });

  it('marca isCurrentMonth / today según la zona horaria', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));
    const cur = await as(USER, () => sqliteStore.getMonthSummary({ month: '2026-08' }));
    expect(cur.isCurrentMonth).toBe(true);
    expect(cur.today).toBe('2026-08-26');
    const past = await as(USER, () => sqliteStore.getMonthSummary({ month: '2026-05' }));
    expect(past.isCurrentMonth).toBe(false);
    expect(past.today).toBeNull();
    vi.useRealTimers();
  });

  it('scopea por usuario', async () => {
    await as(USER, () => sqliteStore.createTask({ date: '2026-08-10', text: 'mía' }));
    const other = await as(OTHER, () => sqliteStore.getMonthSummary({ month: '2026-08' }));
    expect(other.days).toEqual([]);
  });
});

describe('getFocusHeatmap (heatmap de foco)', () => {
  afterEach(() => vi.useRealTimers());

  it('suma segundos por día dentro de la ventana, solo días con foco', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z')); // hoy = miércoles 26

    const heatmap = await as(USER, async () => {
      const a = await sqliteStore.createTask({ date: '2026-08-10', text: 'A' });
      await sqliteStore.logSession({ taskId: a.id, durationSeconds: 1200, start: '09:00', end: '09:20' });
      await sqliteStore.logSession({ taskId: a.id, durationSeconds: 600, start: '10:00', end: '10:10' });
      // día con tarea pero sin sesión: no aparece
      await sqliteStore.createTask({ date: '2026-08-11', text: 'B' });
      return sqliteStore.getFocusHeatmap({ weeks: 4 });
    });

    expect(heatmap.endDate).toBe('2026-08-26');
    // 4 semanas: lunes de esta semana (2026-08-24) menos 3 semanas.
    expect(heatmap.startDate).toBe('2026-08-03');
    expect(heatmap.weeks).toBe(4);
    expect(heatmap.days).toEqual([{ date: '2026-08-10', totalSeconds: 1800 }]);
    expect(heatmap.totalSeconds).toBe(1800);
    expect(heatmap.activeDays).toBe(1);
    expect(heatmap.maxSeconds).toBe(1800);
  });

  it('excluye sesiones anteriores a la ventana', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));

    const heatmap = await as(USER, async () => {
      const old = await sqliteStore.createTask({ date: '2026-06-01', text: 'vieja' });
      await sqliteStore.logSession({ taskId: old.id, durationSeconds: 3600, start: '09:00', end: '10:00' });
      return sqliteStore.getFocusHeatmap({ weeks: 4 });
    });

    expect(heatmap.days).toEqual([]);
    expect(heatmap.totalSeconds).toBe(0);
  });

  it('clampa weeks fuera de rango y scopea por usuario', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));

    await as(USER, async () => {
      const t = await sqliteStore.createTask({ date: '2026-08-25', text: 'mía' });
      await sqliteStore.logSession({ taskId: t.id, durationSeconds: 600, start: '09:00', end: '09:10' });
    });

    const huge = await as(USER, () => sqliteStore.getFocusHeatmap({ weeks: 999 }));
    expect(huge.weeks).toBe(53);
    const tiny = await as(USER, () => sqliteStore.getFocusHeatmap({ weeks: 1 }));
    expect(tiny.weeks).toBe(4);

    const other = await as(OTHER, () => sqliteStore.getFocusHeatmap({ weeks: 8 }));
    expect(other.days).toEqual([]);
  });
});

describe('sesiones + totales', () => {
  it('logSession suma al total del día y de la semana', async () => {
    const view = await as(USER, async () => {
      const a = await sqliteStore.createTask({ date: '2026-08-24', text: 'A' });
      const b = await sqliteStore.createTask({ date: '2026-08-25', text: 'B' });
      await sqliteStore.logSession({ taskId: a.id, durationSeconds: 1500, start: '09:00', end: '09:25' });
      await sqliteStore.logSession({ taskId: b.id, durationSeconds: 600, start: '10:00', end: '10:10' });
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' });
    });
    expect(view.dayTotalSeconds).toBe(1500);
    expect(view.weekTotalSeconds).toBe(2100);
    expect(view.tasks[0].sessions).toHaveLength(1);
  });

  it('updateSession y deleteSession', async () => {
    await as(USER, async () => {
      const t = await sqliteStore.createTask({ date: '2026-08-24', text: 'A' });
      const s = await sqliteStore.logSession({ taskId: t.id, durationSeconds: 60, start: '09:00', end: '09:01' });
      const upd = await sqliteStore.updateSession({ sessionId: s.id, durationSeconds: 120, start: '09:00', end: '09:02' });
      expect(upd.durationSeconds).toBe(120);
      await sqliteStore.deleteSession(s.id);
    });
    expect((await db.execute('SELECT count(*) c FROM work_sessions')).rows[0].c).toBe(0);
  });
});

describe('getSessionsInRange (reporte)', () => {
  it('devuelve las sesiones del rango con el nombre de la tarea', async () => {
    await as(USER, async () => {
      const a = await sqliteStore.createTask({ date: '2026-08-24', text: 'Tarea A' });
      const b = await sqliteStore.createTask({ date: '2026-09-02', text: 'Tarea B' });
      await sqliteStore.logSession({ taskId: a.id, durationSeconds: 1500, start: '09:00', end: '09:25' });
      await sqliteStore.logSession({ taskId: b.id, durationSeconds: 600, start: '10:00', end: '10:10' });
    });
    const rows = await as(USER, () =>
      sqliteStore.getSessionsInRange({ from: '2026-08-01', to: '2026-08-31' })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ task: 'Tarea A', date: '2026-08-24', day: 'Lunes', durationSeconds: 1500 });
  });

  it('valida el rango', async () => {
    await expect(
      as(USER, () => sqliteStore.getSessionsInRange({ from: '2026-08-10', to: '2026-08-01' }))
    ).rejects.toThrow();
  });
});

describe('listFiles', () => {
  it('lista los valores distintos de file', async () => {
    await as(USER, async () => {
      await sqliteStore.createTask({ date: '2026-08-24', text: 'a', fileId: 'Trabajo' });
      await sqliteStore.createTask({ date: '2026-08-24', text: 'b', fileId: 'Casa' });
      await sqliteStore.createTask({ date: '2026-08-24', text: 'c', fileId: 'Trabajo' });
    });
    const files = await as(USER, () => sqliteStore.listFiles());
    expect(files.map((f) => f.id).sort()).toEqual(['Casa', 'Trabajo']);
  });
});

describe('recurrentes', () => {
  it('applyRecurringToWeek crea las que faltan, dedup por nombre, respeta weekdays', async () => {
    await as(USER, async () => {
      await sqliteStore.createRecurringRule({ name: 'Standup' }); // Lun–Vie
      await sqliteStore.createRecurringRule({ name: 'Repaso semanal', weekdays: '5' }); // solo Vie
      // ya existe "standup" el lunes → no se duplica
      await sqliteStore.createTask({ date: '2026-08-24', text: 'standup' });
    });

    const first = await as(USER, () =>
      sqliteStore.applyRecurringToWeek({ week: '2026.08.24 - 2026.08.28' })
    );
    // Standup en Mar/Mié/Jue/Vie (4) + Repaso el Vie (1) = 5
    expect(first.added).toBe(5);

    const second = await as(USER, () =>
      sqliteStore.applyRecurringToWeek({ week: '2026.08.24 - 2026.08.28' })
    );
    expect(second.added).toBe(0);

    const vie = await as(USER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Viernes' })
    );
    expect(vie.tasks.map((t) => t.name).sort()).toEqual(['Repaso semanal', 'Standup']);
  });

  it('CRUD de reglas', async () => {
    const rules = await as(USER, async () => {
      const r = await sqliteStore.createRecurringRule({ name: 'X' });
      await sqliteStore.updateRecurringRule({ id: r.id, name: 'X2', active: false });
      return sqliteStore.listRecurringRules();
    });
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ name: 'X2', active: false });

    await as(USER, () => sqliteStore.deleteRecurringRule(rules[0].id));
    expect(await as(USER, () => sqliteStore.listRecurringRules())).toHaveLength(0);
  });
});

describe('recurrentes automáticas (al abrir la semana)', () => {
  afterEach(() => vi.useRealTimers());

  it('getWeekView materializa las reglas activas de la semana actual, una sola vez', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z')); // miércoles 26; lunes = 24

    const view1 = await as(USER, async () => {
      await sqliteStore.createRecurringRule({ name: 'Standup' }); // Lun–Vie
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Miércoles' });
    });
    expect(view1.tasks.map((t) => t.name)).toEqual(['Standup']);

    const view2 = await as(USER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Miércoles' })
    );
    expect(view2.tasks.map((t) => t.name)).toEqual(['Standup']);
  });

  it('no repone una tarea recurrente que el usuario borró', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));

    const reloaded = await as(USER, async () => {
      await sqliteStore.createRecurringRule({ name: 'Standup' });
      const v = await sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Miércoles' });
      await sqliteStore.deleteTask(v.tasks[0].id);
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Miércoles' });
    });
    expect(reloaded.tasks).toEqual([]);
  });

  it('no toca semanas pasadas', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));

    const past = await as(USER, async () => {
      await sqliteStore.createRecurringRule({ name: 'Standup' });
      return sqliteStore.getWeekView({ week: '2026.08.17 - 2026.08.21', day: 'Lunes' });
    });
    expect(past.tasks).toEqual([]);
  });

  it('aplica a una semana futura al abrirla', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));

    const future = await as(USER, async () => {
      await sqliteStore.createRecurringRule({ name: 'Standup' });
      return sqliteStore.getWeekView({ week: '2026.08.31 - 2026.09.04', day: 'Lunes' });
    });
    expect(future.tasks.map((t) => t.name)).toEqual(['Standup']);
  });

  it('el "Aplicar" manual marca la semana y getWeekView no vuelve a correr', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));

    const reloaded = await as(USER, async () => {
      await sqliteStore.createRecurringRule({ name: 'Standup' });
      await sqliteStore.applyRecurringToWeek({ week: '2026.08.24 - 2026.08.28' });
      const v = await sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Miércoles' });
      await sqliteStore.deleteTask(v.tasks[0].id);
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Miércoles' });
    });
    expect(reloaded.tasks).toEqual([]);
  });

  it('scopea por usuario', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));

    await as(USER, () => sqliteStore.createRecurringRule({ name: 'Standup' }));
    const other = await as(OTHER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Miércoles' })
    );
    expect(other.tasks).toEqual([]);
  });
});

afterEach(() => {
  resetDb();
});
