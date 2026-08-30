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

  it('setea prioridad / notas / vencimiento y los limpia con null', async () => {
    const view = await as(USER, async () => {
      const t = await sqliteStore.createTask({ date: '2026-08-24', text: 'x' });
      await sqliteStore.updateTask({
        taskId: t.id,
        priority: 'high',
        notes: '  con notas  ',
        due: '2026-08-27',
      });
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' });
    });
    expect(view.tasks[0]).toMatchObject({
      priority: 'high',
      notes: 'con notas',
      due: '2026-08-27',
    });
    expect(view.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const cleared = await as(USER, async () => {
      const t = (
        await sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' })
      ).tasks[0];
      await sqliteStore.updateTask({ taskId: t.id, priority: null, notes: '', due: null });
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' });
    });
    expect(cleared.tasks[0]).toMatchObject({ priority: null, notes: null, due: null });
  });

  it('rechaza prioridad y vencimiento inválidos', async () => {
    const t = await as(USER, () => sqliteStore.createTask({ date: '2026-08-24', text: 'x' }));
    await expect(
      as(USER, () => sqliteStore.updateTask({ taskId: t.id, priority: 'urgente' as never }))
    ).rejects.toThrow();
    await expect(
      as(USER, () => sqliteStore.updateTask({ taskId: t.id, due: '27-08-2026' }))
    ).rejects.toThrow();
  });

  it('setea la estimación en minutos y la limpia con null', async () => {
    const view = await as(USER, async () => {
      const t = await sqliteStore.createTask({ date: '2026-08-24', text: 'x' });
      await sqliteStore.updateTask({ taskId: t.id, estimateMinutes: 90 });
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' });
    });
    expect(view.tasks[0].estimateMinutes).toBe(90);

    const cleared = await as(USER, async () => {
      await sqliteStore.updateTask({ taskId: view.tasks[0].id, estimateMinutes: null });
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' });
    });
    expect(cleared.tasks[0].estimateMinutes).toBeNull();
  });

  it('rechaza estimaciones no positivas o absurdas', async () => {
    const t = await as(USER, () => sqliteStore.createTask({ date: '2026-08-24', text: 'x' }));
    await expect(
      as(USER, () => sqliteStore.updateTask({ taskId: t.id, estimateMinutes: 0 }))
    ).rejects.toThrow();
    await expect(
      as(USER, () => sqliteStore.updateTask({ taskId: t.id, estimateMinutes: 999_999 }))
    ).rejects.toThrow();
  });

  it('updateTask sin campos falla', async () => {
    const t = await as(USER, () => sqliteStore.createTask({ date: '2026-08-24', text: 'x' }));
    await expect(as(USER, () => sqliteStore.updateTask({ taskId: t.id }))).rejects.toThrow();
  });
});

describe('etiquetas / proyectos', () => {
  it('CRUD de etiquetas + scope por usuario + nombre único', async () => {
    const a = await as(USER, () => sqliteStore.createTag({ name: '  Proyecto X  ', color: 'blue' }));
    expect(a).toMatchObject({ name: 'Proyecto X', color: 'blue' });

    await expect(as(USER, () => sqliteStore.createTag({ name: 'Proyecto X' }))).rejects.toThrow();

    const renamed = await as(USER, () => sqliteStore.updateTag({ id: a.id, name: 'Proyecto Y', color: 'red' }));
    expect(renamed).toMatchObject({ name: 'Proyecto Y', color: 'red' });

    // color inválido → cae al default
    const c = await as(USER, () => sqliteStore.createTag({ name: 'Casa', color: 'fucsia' }));
    expect(c.color).toBe('slate');

    const mine = await as(USER, () => sqliteStore.listTags());
    expect(mine.map((t) => t.name)).toEqual(['Casa', 'Proyecto Y']);
    expect(await as(OTHER, () => sqliteStore.listTags())).toHaveLength(0);
  });

  it('asigna etiquetas a una tarea y las devuelve en getWeekView', async () => {
    const view = await as(USER, async () => {
      const t1 = await sqliteStore.createTag({ name: 'urgente', color: 'red' });
      const t2 = await sqliteStore.createTag({ name: 'admin' });
      const task = await sqliteStore.createTask({ date: '2026-08-24', text: 'x' });
      await sqliteStore.updateTask({ taskId: task.id, tagIds: [t1.id, t2.id, t1.id] });
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' });
    });
    expect(view.tasks[0].tagIds.sort()).toEqual(view.tags.map((t) => t.id).sort());
    expect(view.tags.map((t) => t.name)).toEqual(['admin', 'urgente']);

    // reemplazo total: pasar [] limpia
    const cleared = await as(USER, async () => {
      await sqliteStore.updateTask({ taskId: view.tasks[0].id, tagIds: [] });
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' });
    });
    expect(cleared.tasks[0].tagIds).toEqual([]);
  });

  it('rechaza etiquetas de otro usuario o inexistentes', async () => {
    const foreign = await as(OTHER, () => sqliteStore.createTag({ name: 'ajena' }));
    await expect(
      as(USER, async () => {
        const task = await sqliteStore.createTask({ date: '2026-08-24', text: 'x' });
        await sqliteStore.updateTask({ taskId: task.id, tagIds: [foreign.id] });
      })
    ).rejects.toThrow();
  });

  it('borrar una etiqueta la quita de las tareas', async () => {
    const view = await as(USER, async () => {
      const tag = await sqliteStore.createTag({ name: 'temporal' });
      const task = await sqliteStore.createTask({ date: '2026-08-24', text: 'x' });
      await sqliteStore.updateTask({ taskId: task.id, tagIds: [tag.id] });
      await sqliteStore.deleteTag(tag.id);
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' });
    });
    expect(view.tags).toHaveLength(0);
    expect(view.tasks[0].tagIds).toEqual([]);
  });

  it('getSessionsInRange trae los tagIds de la tarea', async () => {
    const rows = await as(USER, async () => {
      const tag = await sqliteStore.createTag({ name: 'facturable', color: 'green' });
      const task = await sqliteStore.createTask({ date: '2026-08-24', text: 'x' });
      await sqliteStore.updateTask({ taskId: task.id, tagIds: [tag.id] });
      await sqliteStore.logSession({ taskId: task.id, durationSeconds: 600, start: '09:00', end: '09:10' });
      return sqliteStore.getSessionsInRange({ from: '2026-08-01', to: '2026-08-31' });
    });
    expect(rows[0].tagIds).toHaveLength(1);
  });
});

describe('metas del mes', () => {
  it('crea una meta por etiqueta y calcula el progreso del mes', async () => {
    vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
    const goals = await as(USER, async () => {
      const tag = await sqliteStore.createTag({ name: 'Cliente', color: 'green' });
      const other = await sqliteStore.createTag({ name: 'Interno' });
      const g = await sqliteStore.createGoal({ tagId: tag.id, targetMinutes: 1200 }); // 20h
      void g;

      const a = await sqliteStore.createTask({ date: '2026-08-10', text: 'con cliente' });
      const b = await sqliteStore.createTask({ date: '2026-08-12', text: 'interno' });
      const c = await sqliteStore.createTask({ date: '2026-07-30', text: 'mes pasado' });
      await sqliteStore.updateTask({ taskId: a.id, tagIds: [tag.id] });
      await sqliteStore.updateTask({ taskId: b.id, tagIds: [other.id] });
      await sqliteStore.updateTask({ taskId: c.id, tagIds: [tag.id] });
      await sqliteStore.logSession({ taskId: a.id, durationSeconds: 3600, start: '09:00', end: '10:00' });
      await sqliteStore.logSession({ taskId: b.id, durationSeconds: 7200, start: '11:00', end: '13:00' });
      await sqliteStore.logSession({ taskId: c.id, durationSeconds: 3600, start: '09:00', end: '10:00' });

      return sqliteStore.listGoals();
    });
    vi.useRealTimers();

    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({
      tagName: 'Cliente',
      targetMinutes: 1200,
      loggedSeconds: 3600, // solo la sesión de agosto con la etiqueta correcta
      month: '2026-08',
      dayOfMonth: 15,
      daysInMonth: 31,
    });
  });

  it('meta sin etiqueta suma todas las sesiones del mes', async () => {
    vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
    const goals = await as(USER, async () => {
      await sqliteStore.createGoal({ targetMinutes: 600 });
      const t = await sqliteStore.createTask({ date: '2026-08-05', text: 'x' });
      await sqliteStore.logSession({ taskId: t.id, durationSeconds: 1800, start: '09:00', end: '09:30' });
      return sqliteStore.listGoals();
    });
    vi.useRealTimers();
    expect(goals[0].loggedSeconds).toBe(1800);
    expect(goals[0].tagName).toBeNull();
  });

  it('valida el objetivo y la etiqueta; scope por usuario', async () => {
    await expect(as(USER, () => sqliteStore.createGoal({ targetMinutes: 0 }))).rejects.toThrow();
    const foreign = await as(OTHER, () => sqliteStore.createTag({ name: 'ajena' }));
    await expect(
      as(USER, () => sqliteStore.createGoal({ tagId: foreign.id, targetMinutes: 60 }))
    ).rejects.toThrow();

    const g = await as(USER, () => sqliteStore.createGoal({ targetMinutes: 60 }));
    await expect(as(OTHER, () => sqliteStore.updateGoal({ id: g.id, targetMinutes: 999 }))).rejects.toThrow();
    await as(USER, () => sqliteStore.deleteGoal(g.id));
    expect(await as(USER, () => sqliteStore.listGoals())).toHaveLength(0);
  });
});

describe('plantillas de día', () => {
  it('crea con ítems explícitos y aparece en getWeekView', async () => {
    const view = await as(USER, async () => {
      await sqliteStore.createDayTemplate({
        name: '  Mañana enfocada  ',
        items: [
          { name: 'Revisar inbox', priority: 'med' },
          { name: 'Bloque de foco', estimateMinutes: 90 },
          { name: '' }, // se descarta
        ],
      });
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' });
    });
    expect(view.dayTemplates).toHaveLength(1);
    expect(view.dayTemplates[0].name).toBe('Mañana enfocada');
    expect(view.dayTemplates[0].items.map((i) => i.name)).toEqual(['Revisar inbox', 'Bloque de foco']);
    expect(view.dayTemplates[0].items[0].priority).toBe('med');
    expect(view.dayTemplates[0].items[1].estimateMinutes).toBe(90);
  });

  it('crea como snapshot de un día (captura prioridad/estimación)', async () => {
    const tpl = await as(USER, async () => {
      const a = await sqliteStore.createTask({ date: '2026-08-24', text: 'A' });
      const b = await sqliteStore.createTask({ date: '2026-08-24', text: 'B' });
      await sqliteStore.updateTask({ taskId: a.id, priority: 'high', estimateMinutes: 60 });
      void b;
      return sqliteStore.createDayTemplate({ name: 'Día tipo', fromDate: '2026-08-24' });
    });
    expect(tpl.items.map((i) => i.name)).toEqual(['A', 'B']);
    expect(tpl.items[0]).toMatchObject({ priority: 'high', estimateMinutes: 60 });
  });

  it('aplicar estampa las tareas en el día, con dedup por nombre', async () => {
    const view = await as(USER, async () => {
      const tpl = await sqliteStore.createDayTemplate({
        name: 't',
        items: [{ name: 'Standup', priority: 'low' }, { name: 'Deep work' }],
      });
      await sqliteStore.createTask({ date: '2026-08-25', text: 'standup' }); // ya existe (normalizado)
      const r1 = await sqliteStore.applyDayTemplate({ id: tpl.id, date: '2026-08-25' });
      expect(r1.added).toBe(1); // solo "Deep work"
      const r2 = await sqliteStore.applyDayTemplate({ id: tpl.id, date: '2026-08-25' });
      expect(r2.added).toBe(0); // idempotente
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Martes' });
    });
    expect(view.tasks.map((t) => t.name).sort()).toEqual(['Deep work', 'standup']);
  });

  it('renombra, reemplaza ítems y borra; scope por usuario', async () => {
    const tpl = await as(USER, () =>
      sqliteStore.createDayTemplate({ name: 'orig', items: [{ name: 'x' }] })
    );
    const upd = await as(USER, () =>
      sqliteStore.updateDayTemplate({ id: tpl.id, name: 'nuevo', items: [{ name: 'a' }, { name: 'b' }] })
    );
    expect(upd).toMatchObject({ name: 'nuevo' });
    expect(upd.items.map((i) => i.name)).toEqual(['a', 'b']);

    await expect(
      as(OTHER, () => sqliteStore.updateDayTemplate({ id: tpl.id, name: 'hack' }))
    ).rejects.toThrow();

    await as(USER, () => sqliteStore.deleteDayTemplate(tpl.id));
    const view = await as(USER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' })
    );
    expect(view.dayTemplates).toHaveLength(0);
    expect((await db.execute('SELECT count(*) c FROM day_template_items')).rows[0].c).toBe(0);
  });
});

describe('inbox (tareas sin fecha)', () => {
  it('createTask sin fecha va al inbox, no a un día', async () => {
    const view = await as(USER, async () => {
      await sqliteStore.createTask({ text: 'idea suelta' });
      await sqliteStore.createTask({ date: '2026-08-24', text: 'con fecha' });
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' });
    });
    expect(view.tasks.map((t) => t.name)).toEqual(['con fecha']);
    expect(view.inbox.map((t) => t.name)).toEqual(['idea suelta']);
    expect(view.inbox[0].date).toBeNull();
  });

  it('programar una tarea del inbox la saca del inbox y la pone en el día', async () => {
    const view = await as(USER, async () => {
      const t = await sqliteStore.createTask({ text: 'programame' });
      await sqliteStore.updateTaskPosition({ taskId: t.id, date: '2026-08-25' });
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Martes' });
    });
    expect(view.inbox).toHaveLength(0);
    expect(view.tasks.map((t) => t.name)).toEqual(['programame']);
  });

  it('sacar de la agenda: date null manda la tarea al inbox', async () => {
    const view = await as(USER, async () => {
      const t = await sqliteStore.createTask({ date: '2026-08-24', text: 'a inbox' });
      await sqliteStore.updateTaskPosition({ taskId: t.id, date: null });
      return sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' });
    });
    expect(view.tasks).toHaveLength(0);
    expect(view.inbox.map((t) => t.name)).toEqual(['a inbox']);
  });

  it('no deja mandar al inbox una tarea con tiempo registrado', async () => {
    await expect(
      as(USER, async () => {
        const t = await sqliteStore.createTask({ date: '2026-08-24', text: 'con sesión' });
        await sqliteStore.logSession({ taskId: t.id, durationSeconds: 60, start: '09:00', end: '09:01' });
        await sqliteStore.updateTaskPosition({ taskId: t.id, date: null });
      })
    ).rejects.toThrow();
  });

  it('no deja registrar tiempo en una tarea sin fecha', async () => {
    await expect(
      as(USER, async () => {
        const t = await sqliteStore.createTask({ text: 'sin fecha' });
        await sqliteStore.logSession({ taskId: t.id, durationSeconds: 60, start: '09:00', end: '09:01' });
      })
    ).rejects.toThrow();
  });

  it('el inbox se scopea por usuario y por contexto', async () => {
    await as(USER, () => sqliteStore.createTask({ text: 'trabajo', fileId: 'Trabajo' }));
    await as(USER, () => sqliteStore.createTask({ text: 'casa', fileId: 'Casa' }));
    await as(OTHER, () => sqliteStore.createTask({ text: 'ajena' }));

    const trabajo = await as(USER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes', fileId: 'Trabajo' })
    );
    expect(trabajo.inbox.map((t) => t.name)).toEqual(['trabajo']);
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

describe('bulkTasks (acciones en lote)', () => {
  async function three(): Promise<string[]> {
    return as(USER, async () => {
      const a = await sqliteStore.createTask({ date: '2026-08-24', text: 'A' });
      const b = await sqliteStore.createTask({ date: '2026-08-24', text: 'B' });
      const c = await sqliteStore.createTask({ date: '2026-08-24', text: 'C' });
      return [a.id, b.id, c.id];
    });
  }
  const lunes = () =>
    as(USER, () => sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' }));

  it('complete marca todas hechas', async () => {
    const [a, b] = await three();
    const res = await as(USER, () => sqliteStore.bulkTasks({ op: 'complete', ids: [a, b] }));
    expect(res).toEqual({ affected: 2, skipped: 0 });
    const view = await lunes();
    expect(view.tasks.filter((t) => t.done).map((t) => t.name).sort()).toEqual(['A', 'B']);
  });

  it('move manda las tareas a otro día y arrastra sus sesiones', async () => {
    const [a, b, c] = await three();
    await as(USER, () =>
      sqliteStore.logSession({ taskId: a, durationSeconds: 600, start: '09:00', end: '09:10' })
    );
    const res = await as(USER, () =>
      sqliteStore.bulkTasks({ op: 'move', ids: [a, b, c], date: '2026-08-26' })
    );
    expect(res.affected).toBe(3);
    expect((await lunes()).tasks).toHaveLength(0);
    const miercoles = await as(USER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Miércoles' })
    );
    expect(miercoles.tasks.map((t) => t.name)).toEqual(['A', 'B', 'C']);
    expect(miercoles.tasks[0].sessions[0].durationSeconds).toBe(600);
  });

  it('add_tag agrega la etiqueta a todas (idempotente)', async () => {
    const [a, b] = await three();
    const tag = await as(USER, () => sqliteStore.createTag({ name: 'Proyecto', color: 'blue' }));
    await as(USER, () => sqliteStore.bulkTasks({ op: 'add_tag', ids: [a, b], tagId: tag.id }));
    await as(USER, () => sqliteStore.bulkTasks({ op: 'add_tag', ids: [a, b], tagId: tag.id }));
    const view = await lunes();
    expect(view.tasks.filter((t) => t.tagIds.includes(tag.id)).map((t) => t.name).sort()).toEqual([
      'A',
      'B',
    ]);
  });

  it('inbox saltea las que tienen tiempo registrado', async () => {
    const [a, b, c] = await three();
    await as(USER, () =>
      sqliteStore.logSession({ taskId: b, durationSeconds: 600, start: '09:00', end: '09:10' })
    );
    const res = await as(USER, () => sqliteStore.bulkTasks({ op: 'inbox', ids: [a, b, c] }));
    expect(res).toEqual({ affected: 2, skipped: 1 });
    const view = await lunes();
    expect(view.tasks.map((t) => t.name)).toEqual(['B']);
    expect(view.inbox.map((t) => t.name).sort()).toEqual(['A', 'C']);
  });

  it('delete borra tareas y sesiones', async () => {
    const [a, b, c] = await three();
    await as(USER, () =>
      sqliteStore.logSession({ taskId: a, durationSeconds: 600, start: '09:00', end: '09:10' })
    );
    await as(USER, () => sqliteStore.bulkTasks({ op: 'delete', ids: [a, b] }));
    expect((await lunes()).tasks.map((t) => t.name)).toEqual(['C']);
    expect((await db.execute('SELECT count(*) c FROM work_sessions')).rows[0].c).toBe(0);
  });

  it('scopea por usuario e ignora ids ajenos', async () => {
    const [a] = await three();
    const mine = await as(OTHER, () => sqliteStore.createTask({ date: '2026-08-24', text: 'ajena' }));
    const res = await as(USER, () => sqliteStore.bulkTasks({ op: 'complete', ids: [a, mine.id] }));
    expect(res.affected).toBe(1); // solo la propia
    const otherView = await as(OTHER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' })
    );
    expect(otherView.tasks[0].done).toBe(false);
  });

  it('rechaza op inválida y lista vacía', async () => {
    await expect(as(USER, () => sqliteStore.bulkTasks({ op: 'nope', ids: ['x'] }))).rejects.toThrow();
    await expect(as(USER, () => sqliteStore.bulkTasks({ op: 'complete', ids: [] }))).rejects.toThrow();
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

describe('getAnalytics', () => {
  it('agrega las sesiones de la ventana y la tasa de completado', async () => {
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z')); // jueves
    const a = await as(USER, async () => {
      const t1 = await sqliteStore.createTask({ date: '2026-08-24', text: 'a' }); // lunes
      const t2 = await sqliteStore.createTask({ date: '2026-08-26', text: 'b' }); // miércoles
      await sqliteStore.updateTask({ taskId: t1.id, done: true });
      await sqliteStore.logSession({ taskId: t1.id, durationSeconds: 3600, start: '09:00', end: '10:00' });
      await sqliteStore.logSession({ taskId: t2.id, durationSeconds: 1800, start: '15:30', end: '16:00' });
      return sqliteStore.getAnalytics({ weeks: 4 });
    });
    vi.useRealTimers();

    expect(a.weeks).toBe(4);
    expect(a.totalSeconds).toBe(5400);
    expect(a.activeDays).toBe(2);
    expect(a.byWeekday[0].totalSeconds).toBe(3600); // lunes
    expect(a.byHour[9].totalSeconds).toBe(3600);
    expect(a.byHour[15].totalSeconds).toBe(1800);
    expect(a.completion).toEqual({ total: 2, done: 1 });
    expect(a.byWeek).toHaveLength(4);
  });

  it('scopea por usuario', async () => {
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z'));
    await as(USER, async () => {
      const t = await sqliteStore.createTask({ date: '2026-08-24', text: 'x' });
      await sqliteStore.logSession({ taskId: t.id, durationSeconds: 3600, start: '09:00', end: '10:00' });
    });
    const other = await as(OTHER, () => sqliteStore.getAnalytics({ weeks: 4 }));
    vi.useRealTimers();
    expect(other.totalSeconds).toBe(0);
  });

  it('estimateAccuracy cruza estimación vs registrado de tareas completadas', async () => {
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z'));
    const a = await as(USER, async () => {
      for (let i = 0; i < 3; i++) {
        const t = await sqliteStore.createTask({ date: '2026-08-24', text: `t${i}` });
        await sqliteStore.updateTask({ taskId: t.id, estimateMinutes: 60, done: true });
        await sqliteStore.logSession({
          taskId: t.id,
          durationSeconds: 5400, // 90m real vs 60m estimado
          start: '09:00',
          end: '10:30',
        });
      }
      // Una estimada pero sin terminar → no cuenta.
      const open = await sqliteStore.createTask({ date: '2026-08-25', text: 'abierta' });
      await sqliteStore.updateTask({ taskId: open.id, estimateMinutes: 30 });
      await sqliteStore.logSession({ taskId: open.id, durationSeconds: 9999, start: '11:00', end: '13:00' });
      return sqliteStore.getAnalytics({ weeks: 4 });
    });
    vi.useRealTimers();

    expect(a.estimateAccuracy).not.toBeNull();
    expect(a.estimateAccuracy!.count).toBe(3);
    expect(a.estimateAccuracy!.biasPct).toBe(50);
    expect(a.estimateAccuracy!.suggestedFactor).toBe(1.5);
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

  it('trae taskId y la estimación de la tarea en cada fila', async () => {
    await as(USER, async () => {
      const a = await sqliteStore.createTask({ date: '2026-08-24', text: 'Estimada' });
      await sqliteStore.updateTask({ taskId: a.id, estimateMinutes: 120 });
      await sqliteStore.logSession({ taskId: a.id, durationSeconds: 1500, start: '09:00', end: '09:25' });
    });
    const rows = await as(USER, () =>
      sqliteStore.getSessionsInRange({ from: '2026-08-01', to: '2026-08-31' })
    );
    expect(rows[0]).toMatchObject({ estimateMinutes: 120 });
    expect(rows[0].taskId).toEqual(expect.any(String));
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

describe('calendarios iCal', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function icsWith(...vevents: string[]): string {
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//t//EN',
      'BEGIN:VTIMEZONE',
      'TZID:America/El_Salvador',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:-0600',
      'TZOFFSETTO:-0600',
      'END:STANDARD',
      'END:VTIMEZONE',
      ...vevents,
      'END:VCALENDAR',
    ].join('\r\n');
  }

  function vevent(uid: string, summary: string, day: string, opts: { status?: string } = {}): string {
    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `SUMMARY:${summary}`,
      `DTSTART;TZID=America/El_Salvador:${day}T090000`,
      `DTEND;TZID=America/El_Salvador:${day}T100000`,
      ...(opts.status ? [`STATUS:${opts.status}`] : []),
      'END:VEVENT',
    ].join('\r\n');
  }

  function stubFetch(text: string, ok = true, status = 200): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok,
        status,
        arrayBuffer: async () => new TextEncoder().encode(text).buffer,
      }))
    );
  }

  async function thursday(): Promise<{ name: string; source: string }[]> {
    const view = await as(USER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Jueves' })
    );
    return view.tasks.map((t) => ({ name: t.name, source: t.source }));
  }

  it('materializa los eventos como tareas del día correcto', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));
    stubFetch(icsWith(vevent('a', 'Reunión', '20260827')));

    const feed = await as(USER, () =>
      sqliteStore.createCalendarFeed({ name: 'Trabajo', url: 'https://x.test/c.ics' })
    );
    const res = await as(USER, () => sqliteStore.syncCalendarFeeds({ feedId: feed.id }));
    expect(res.added).toBe(1);
    expect(res.changed).toBe(true);
    expect(await thursday()).toEqual([{ name: 'Reunión', source: 'calendar' }]);

    const feeds = await as(USER, () => sqliteStore.listCalendarFeeds());
    expect(feeds[0].lastError).toBeNull();
    expect(feeds[0].lastSyncedAt).not.toBeNull();
  });

  it('re-sync: agrega nuevos, actualiza los sin tocar, borra los que se fueron', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));
    stubFetch(icsWith(vevent('a', 'Uno', '20260827'), vevent('b', 'Dos', '20260827')));
    const feed = await as(USER, () =>
      sqliteStore.createCalendarFeed({ url: 'https://x.test/c.ics' })
    );
    await as(USER, () => sqliteStore.syncCalendarFeeds({ feedId: feed.id }));
    expect((await thursday()).map((t) => t.name).sort()).toEqual(['Dos', 'Uno']);

    // 'a' renombrado, 'b' se fue, 'c' nuevo.
    stubFetch(icsWith(vevent('a', 'Uno (v2)', '20260827'), vevent('c', 'Tres', '20260827')));
    const res = await as(USER, () => sqliteStore.syncCalendarFeeds({ feedId: feed.id }));
    expect(res).toMatchObject({ added: 1, updated: 1, removed: 1 });
    expect((await thursday()).map((t) => t.name).sort()).toEqual(['Tres', 'Uno (v2)']);
  });

  it('no pisa una tarea que el usuario completó', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));
    stubFetch(icsWith(vevent('a', 'Reunión', '20260827')));
    const feed = await as(USER, () =>
      sqliteStore.createCalendarFeed({ url: 'https://x.test/c.ics' })
    );
    await as(USER, () => sqliteStore.syncCalendarFeeds({ feedId: feed.id }));

    const view = await as(USER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Jueves' })
    );
    await as(USER, () => sqliteStore.updateTask({ taskId: view.tasks[0].id, done: true }));

    // el evento desaparece del feed → la tarea completada NO se borra, se huerfaniza.
    stubFetch(icsWith());
    const res = await as(USER, () => sqliteStore.syncCalendarFeeds({ feedId: feed.id }));
    expect(res.removed).toBe(1); // cuenta remove+orphan
    const after = await thursday();
    expect(after).toEqual([{ name: 'Reunión', source: 'calendar' }]);
  });

  it('guarda el error del feed sin tirar la operación', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));
    stubFetch('not found', false, 404);
    const feed = await as(USER, () =>
      sqliteStore.createCalendarFeed({ url: 'https://x.test/c.ics' })
    );
    const res = await as(USER, () => sqliteStore.syncCalendarFeeds({ feedId: feed.id }));
    expect(res.added).toBe(0);
    const feeds = await as(USER, () => sqliteStore.listCalendarFeeds());
    expect(feeds[0].lastError).toContain('404');
  });

  it('deleteCalendarFeed borra el feed y sus tareas sin sesiones', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));
    stubFetch(icsWith(vevent('a', 'Reunión', '20260827')));
    const feed = await as(USER, () =>
      sqliteStore.createCalendarFeed({ url: 'https://x.test/c.ics' })
    );
    await as(USER, () => sqliteStore.syncCalendarFeeds({ feedId: feed.id }));
    await as(USER, () => sqliteStore.deleteCalendarFeed(feed.id));

    expect(await as(USER, () => sqliteStore.listCalendarFeeds())).toEqual([]);
    expect(await thursday()).toEqual([]);
  });

  it('scopea los feeds por usuario', async () => {
    const feed = await as(USER, () =>
      sqliteStore.createCalendarFeed({ url: 'https://x.test/c.ics' })
    );
    expect(await as(OTHER, () => sqliteStore.listCalendarFeeds())).toEqual([]);
    await expect(
      as(OTHER, () => sqliteStore.updateCalendarFeed({ id: feed.id, enabled: false }))
    ).rejects.toThrow();
  });
});

describe('searchTasks (búsqueda de tareas)', () => {
  it('encuentra por subcadena, sin distinguir mayúsculas, en cualquier semana', async () => {
    await as(USER, async () => {
      await sqliteStore.createTask({ date: '2026-08-24', text: 'Revisar informe anual' });
      await sqliteStore.createTask({ date: '2026-09-14', text: 'Llamar al banco' });
      await sqliteStore.createTask({ date: '2026-07-06', text: 'Preparar INFORME de gastos' });
    });

    const results = await as(USER, () => sqliteStore.searchTasks({ query: 'informe' }));
    expect(results.map((r) => r.name)).toEqual([
      'Revisar informe anual',
      'Preparar INFORME de gastos',
    ]);
    expect(results[0]).toMatchObject({
      date: '2026-08-24',
      weekLabel: '2026.08.24 - 2026.08.28',
      day: 'Lunes',
      done: false,
      hasSessions: false,
    });
  });

  it('ordena las fechadas por fecha descendente y deja el inbox al final', async () => {
    await as(USER, async () => {
      await sqliteStore.createTask({ date: '2026-08-10', text: 'plan viejo' });
      await sqliteStore.createTask({ date: '2026-08-26', text: 'plan nuevo' });
      await sqliteStore.createTask({ text: 'plan sin fecha' });
    });

    const results = await as(USER, () => sqliteStore.searchTasks({ query: 'plan' }));
    expect(results.map((r) => r.name)).toEqual(['plan nuevo', 'plan viejo', 'plan sin fecha']);
    const inbox = results[2];
    expect(inbox.date).toBeNull();
    expect(inbox.weekLabel).toBeNull();
    expect(inbox.day).toBeNull();
  });

  it('devuelve [] con query vacío o solo espacios', async () => {
    await as(USER, () => sqliteStore.createTask({ date: '2026-08-24', text: 'algo' }));
    expect(await as(USER, () => sqliteStore.searchTasks({ query: '' }))).toEqual([]);
    expect(await as(USER, () => sqliteStore.searchTasks({ query: '   ' }))).toEqual([]);
  });

  it('trata los comodines de LIKE como texto literal', async () => {
    await as(USER, async () => {
      await sqliteStore.createTask({ date: '2026-08-24', text: 'progreso 50% del hito' });
      await sqliteStore.createTask({ date: '2026-08-25', text: 'sin porcentaje' });
    });
    const hit = await as(USER, () => sqliteStore.searchTasks({ query: '50%' }));
    expect(hit.map((r) => r.name)).toEqual(['progreso 50% del hito']);
    // '%' es literal: encuentra la tarea con el signo, no todas.
    const literal = await as(USER, () => sqliteStore.searchTasks({ query: '%' }));
    expect(literal.map((r) => r.name)).toEqual(['progreso 50% del hito']);
  });

  it('scopea por usuario y por contexto (file)', async () => {
    await as(USER, async () => {
      await sqliteStore.createTask({ date: '2026-08-24', text: 'reunión Trabajo', fileId: 'Trabajo' });
      await sqliteStore.createTask({ date: '2026-08-24', text: 'reunión Casa', fileId: 'Casa' });
    });
    await as(OTHER, () => sqliteStore.createTask({ date: '2026-08-24', text: 'reunión ajena' }));

    const mine = await as(USER, () =>
      sqliteStore.searchTasks({ query: 'reunión', fileId: 'Trabajo' })
    );
    expect(mine.map((r) => r.name)).toEqual(['reunión Trabajo']);
    expect(await as(OTHER, () => sqliteStore.searchTasks({ query: 'reunión' }))).toEqual([
      expect.objectContaining({ name: 'reunión ajena' }),
    ]);
  });

  it('marca hasSessions cuando la tarea tiene tiempo registrado', async () => {
    const task = await as(USER, () =>
      sqliteStore.createTask({ date: '2026-08-24', text: 'con tiempo' })
    );
    await as(USER, () =>
      sqliteStore.logSession({ taskId: task.id, durationSeconds: 1500, start: '09:00', end: '09:25' })
    );
    const results = await as(USER, () => sqliteStore.searchTasks({ query: 'con tiempo' }));
    expect(results[0].hasSessions).toBe(true);
  });
});

describe('backup / restore', () => {
  async function seedDataset(): Promise<void> {
    await as(USER, async () => {
      const tag = await sqliteStore.createTag({ name: 'Proyecto X', color: 'blue' });
      const task = await sqliteStore.createTask({ date: '2026-08-24', text: 'Tarea con todo', fileId: 'Trabajo' });
      await sqliteStore.updateTask({
        taskId: task.id,
        tagIds: [tag.id],
        priority: 'high',
        estimateMinutes: 90,
        notes: 'unas notas',
      });
      await sqliteStore.logSession({ taskId: task.id, durationSeconds: 1500, start: '09:00', end: '09:25' });
      await sqliteStore.createTask({ text: 'Pendiente sin fecha', fileId: 'Trabajo' });
      await sqliteStore.createRecurringRule({ name: 'Standup', weekdays: '1,2,3,4,5' });
      await sqliteStore.createDayTemplate({
        name: 'Día tipo',
        items: [{ name: 'Revisar inbox', priority: 'med' }],
      });
      await sqliteStore.createGoal({ tagId: tag.id, targetMinutes: 1200 });
      await sqliteStore.createCalendarFeed({ name: 'Trabajo', url: 'https://x.test/c.ics', fileId: 'Trabajo' });
    });
  }

  it('exporta todas las tablas de dominio del usuario, sin user_id', async () => {
    await seedDataset();
    const dump = await as(USER, () => sqliteStore.exportBackup());

    expect(dump.format).toBe('pomotion-backup');
    expect(dump.version).toBe(1);
    expect(dump.data.tasks).toHaveLength(2);
    expect(dump.data.work_sessions).toHaveLength(1);
    expect(dump.data.tags).toHaveLength(1);
    expect(dump.data.task_tags).toHaveLength(1);
    expect(dump.data.recurring_rules).toHaveLength(1);
    expect(dump.data.day_templates).toHaveLength(1);
    expect(dump.data.day_template_items).toHaveLength(1);
    expect(dump.data.goals).toHaveLength(1);
    expect(dump.data.calendar_feeds).toHaveLength(1);
    expect(dump.data.tasks[0]).not.toHaveProperty('user_id');
  });

  it('restaura un backup en una cuenta vacía preservando las referencias', async () => {
    await seedDataset();
    const dump = await as(USER, () => sqliteStore.exportBackup());

    const result = await as(OTHER, () => sqliteStore.importBackup({ backup: dump }));
    expect(result.imported.tasks).toBe(2);
    expect(result.imported.work_sessions).toBe(1);

    const view = await as(OTHER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes', fileId: 'Trabajo' })
    );
    const restored = view.tasks.find((t) => t.name === 'Tarea con todo');
    expect(restored).toBeDefined();
    expect(restored!.priority).toBe('high');
    expect(restored!.estimateMinutes).toBe(90);
    expect(restored!.sessions).toHaveLength(1);
    expect(restored!.tagIds).toEqual([view.tags[0].id]); // el task_tag sigue apuntando bien
    expect(view.inbox.map((t) => t.name)).toEqual(['Pendiente sin fecha']);
    expect(view.dayTemplates[0].items[0].name).toBe('Revisar inbox');

    const goals = await as(OTHER, () => sqliteStore.listGoals());
    expect(goals[0].targetMinutes).toBe(1200);
    const feeds = await as(OTHER, () => sqliteStore.listCalendarFeeds());
    expect(feeds[0].url).toBe('https://x.test/c.ics');
  });

  it('rechaza el restore si la cuenta ya tiene datos', async () => {
    await seedDataset();
    const dump = await as(USER, () => sqliteStore.exportBackup());
    await as(OTHER, () => sqliteStore.createTask({ date: '2026-08-24', text: 'ya tengo algo' }));

    await expect(as(OTHER, () => sqliteStore.importBackup({ backup: dump }))).rejects.toThrow(
      /cuenta vacía/
    );
  });

  it('rechaza un payload que no es un backup válido', async () => {
    await expect(as(USER, () => sqliteStore.importBackup({ backup: { nope: true } }))).rejects.toThrow();
  });
});

describe('getWeekView.dueReminders (aviso de vencimientos)', () => {
  afterEach(() => vi.useRealTimers());

  it('lista las tareas sin hacer que vencen hoy o antes, por fecha', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T18:00:00Z')); // miércoles en El Salvador

    await as(USER, async () => {
      const overdue = await sqliteStore.createTask({ date: '2026-08-24', text: 'Vencida' });
      const today = await sqliteStore.createTask({ date: '2026-08-26', text: 'Vence hoy' });
      const soon = await sqliteStore.createTask({ date: '2026-08-26', text: 'Vence mañana' });
      const doneOne = await sqliteStore.createTask({ date: '2026-08-24', text: 'Hecha y vencida' });
      await sqliteStore.updateTask({ taskId: overdue.id, due: '2026-08-20' });
      await sqliteStore.updateTask({ taskId: today.id, due: '2026-08-26' });
      await sqliteStore.updateTask({ taskId: soon.id, due: '2026-08-27' });
      await sqliteStore.updateTask({ taskId: doneOne.id, due: '2026-08-19', done: true });
    });

    const view = await as(USER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Miércoles' })
    );
    expect(view.dueReminders.map((r) => r.name)).toEqual(['Vencida', 'Vence hoy']);
    expect(view.dueReminders[0]).toMatchObject({ due: '2026-08-20' });
  });

  it('scopea por usuario y por contexto', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T18:00:00Z'));

    await as(USER, async () => {
      const a = await sqliteStore.createTask({ date: '2026-08-24', text: 'Trabajo', fileId: 'Trabajo' });
      const b = await sqliteStore.createTask({ date: '2026-08-24', text: 'Casa', fileId: 'Casa' });
      await sqliteStore.updateTask({ taskId: a.id, due: '2026-08-20' });
      await sqliteStore.updateTask({ taskId: b.id, due: '2026-08-20' });
    });

    const trabajo = await as(USER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes', fileId: 'Trabajo' })
    );
    expect(trabajo.dueReminders.map((r) => r.name)).toEqual(['Trabajo']);

    const other = await as(OTHER, () =>
      sqliteStore.getWeekView({ week: '2026.08.24 - 2026.08.28', day: 'Lunes' })
    );
    expect(other.dueReminders).toEqual([]);
  });
});

afterEach(() => {
  resetDb();
});
