import { describe, expect, it } from 'vitest';
import { BACKUP_TABLES, buildInserts, parseBackup, remapIds } from './backup.js';

function backup(data: Record<string, unknown>) {
  return { format: 'pomotion-backup', version: 1, exportedAt: '2026-08-29T00:00:00.000Z', data };
}

describe('parseBackup', () => {
  it('acepta un backup bien formado y completa las tablas ausentes con []', () => {
    const out = parseBackup(backup({ tasks: [{ id: 't1', name: 'A', done: 0 }] }));
    expect(out.data.tasks).toEqual([{ id: 't1', name: 'A', done: 0 }]);
    expect(out.data.work_sessions).toEqual([]);
    expect(Object.keys(out.data).sort()).toEqual(BACKUP_TABLES.map((t) => t.table).sort());
  });

  it('ignora columnas desconocidas (backup de una versión futura)', () => {
    const out = parseBackup(backup({ tags: [{ id: 'g1', name: 'x', color: 'red', future_col: 'nope' }] }));
    expect(out.data.tags).toEqual([{ id: 'g1', name: 'x', color: 'red' }]);
  });

  it('rechaza formato o versión que no reconoce', () => {
    expect(() => parseBackup({ format: 'otra-cosa', version: 1, data: {} })).toThrow(/backup de pomotion/);
    expect(() => parseBackup({ format: 'pomotion-backup', version: 2, data: {} })).toThrow(/no soportada/);
  });

  it('rechaza payloads que no son objeto o sin "data"', () => {
    expect(() => parseBackup(null)).toThrow();
    expect(() => parseBackup([])).toThrow();
    expect(() => parseBackup({ format: 'pomotion-backup', version: 1 })).toThrow(/data/);
  });

  it('rechaza una tabla que no es lista, o filas / valores inválidos', () => {
    expect(() => parseBackup(backup({ tasks: { id: 'x' } }))).toThrow(/lista/);
    expect(() => parseBackup(backup({ tasks: [42] }))).toThrow(/Fila inválida/);
    expect(() => parseBackup(backup({ tasks: [{ id: 't', notes: { nested: true } }] }))).toThrow(/Valor inválido/);
  });
});

describe('remapIds', () => {
  it('regenera ids y reescribe las referencias', () => {
    let n = 0;
    const gen = () => `new-${++n}`;
    const out = remapIds(
      {
        tags: [{ id: 'tag-a', name: 'X', color: 'red' }],
        tasks: [{ id: 'task-a', name: 'T', recurring_rule_id: 'rule-a', feed_id: null }],
        recurring_rules: [{ id: 'rule-a', name: 'R' }],
        task_tags: [{ task_id: 'task-a', tag_id: 'tag-a' }],
        work_sessions: [{ id: 'ws-a', task_id: 'task-a', duration_sec: 60 }],
      } as never,
      gen
    );
    const taskId = out.tasks[0].id as string;
    const tagId = out.tags[0].id as string;
    expect(taskId).toMatch(/^new-/);
    expect(out.tasks[0].recurring_rule_id).toBe(out.recurring_rules[0].id);
    expect(out.task_tags[0]).toEqual({ task_id: taskId, tag_id: tagId });
    expect(out.work_sessions[0].task_id).toBe(taskId);
  });

  it('deja una referencia a un id ausente como está', () => {
    const out = remapIds({ tasks: [{ id: 't', recurring_rule_id: 'ghost' }] } as never, () => 'x');
    expect(out.tasks[0].recurring_rule_id).toBe('ghost');
  });
});

describe('buildInserts', () => {
  it('sin filas → sin statements', () => {
    expect(buildInserts('tags', ['id', 'name'], [])).toEqual([]);
  });

  it('arma un INSERT multi-fila con identificadores citados', () => {
    const stmts = buildInserts('tasks', ['id', 'order'], [{ id: 'a', order: 1 }, { id: 'b', order: 2.5 }]);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe('INSERT INTO "tasks" ("id", "order") VALUES (?, ?), (?, ?)');
    expect(stmts[0].args).toEqual(['a', 1, 'b', 2.5]);
  });

  it('inyecta la columna extra (user_id) al principio de cada fila', () => {
    const stmts = buildInserts('tags', ['id'], [{ id: 'g1' }], { column: 'user_id', value: 'u1' });
    expect(stmts[0].sql).toBe('INSERT INTO "tags" ("user_id", "id") VALUES (?, ?)');
    expect(stmts[0].args).toEqual(['u1', 'g1']);
  });

  it('completa con null las columnas ausentes en la fila', () => {
    const stmts = buildInserts('tasks', ['id', 'notes'], [{ id: 'a' }]);
    expect(stmts[0].args).toEqual(['a', null]);
  });

  it('parte en varios statements cuando se pasa del tope de parámetros', () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: `t${i}` }));
    const stmts = buildInserts('tasks', ['id'], rows);
    expect(stmts.length).toBeGreaterThan(1);
    expect(stmts.reduce((n, s) => n + s.args.length, 0)).toBe(2500);
    expect(stmts.every((s) => s.args.length <= 900)).toBe(true);
  });
});
