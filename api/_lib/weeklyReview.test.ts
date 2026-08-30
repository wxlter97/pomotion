import { describe, expect, it } from 'vitest';
import { buildReviewSummary, type ReviewTaskRow } from './weeklyReview.js';

const tags = [
  { id: 'tg1', name: 'Proyecto A', color: 'blue' },
  { id: 'tg2', name: 'Admin', color: 'gray' },
];

function summary(over: Partial<Parameters<typeof buildReviewSummary>[0]> = {}) {
  const tasks: ReviewTaskRow[] = over.tasks ?? [
    { id: 't1', name: 'Hecha con tiempo', date: '2026-08-24', done: true, file: 'Trabajo' },
    { id: 't2', name: 'Pendiente sin tiempo', date: '2026-08-25', done: false, file: 'Trabajo' },
    { id: 't3', name: 'Pendiente con tiempo', date: '2026-08-24', done: false, file: 'Casa' },
    { id: 't4', name: 'Hecha sin contexto', date: '2026-08-26', done: true, file: null },
  ];
  return buildReviewSummary({
    tasks,
    sessions: over.sessions ?? [
      { taskId: 't1', durationSeconds: 3600 },
      { taskId: 't1', durationSeconds: 1800 },
      { taskId: 't3', durationSeconds: 900 },
    ],
    tagIdsByTask: over.tagIdsByTask ?? new Map([
      ['t1', ['tg1']],
      ['t3', ['tg1', 'tg2']],
    ]),
    tags: over.tags ?? tags,
    previousLoggedSeconds: over.previousLoggedSeconds ?? 7200,
  });
}

describe('buildReviewSummary', () => {
  it('cuenta hechas / totales y el tiempo registrado', () => {
    const s = summary();
    expect(s.completedCount).toBe(2);
    expect(s.totalCount).toBe(4);
    expect(s.loggedSeconds).toBe(3600 + 1800 + 900);
    expect(s.previousLoggedSeconds).toBe(7200);
  });

  it('agrupa el tiempo por contexto, desc, con "Sin contexto"', () => {
    const s = summary({
      sessions: [
        { taskId: 't1', durationSeconds: 1000 }, // Trabajo
        { taskId: 't3', durationSeconds: 5000 }, // Casa
        { taskId: 't4', durationSeconds: 200 }, // null
      ],
    });
    expect(s.byContext).toEqual([
      { label: 'Casa', file: 'Casa', seconds: 5000 },
      { label: 'Trabajo', file: 'Trabajo', seconds: 1000 },
      { label: 'Sin contexto', file: null, seconds: 200 },
    ]);
  });

  it('el tiempo de una tarea suma a cada una de sus etiquetas', () => {
    const s = summary();
    // t1 (5400s) -> tg1 ; t3 (900s) -> tg1 + tg2
    expect(s.byTag).toEqual([
      { tagId: 'tg1', name: 'Proyecto A', color: 'blue', seconds: 6300 },
      { tagId: 'tg2', name: 'Admin', color: 'gray', seconds: 900 },
    ]);
  });

  it('lista las pendientes por fecha con día, contexto y tiempo', () => {
    const s = summary();
    expect(s.unfinished.map((t) => [t.name, t.day, t.hasSessions, t.loggedSeconds])).toEqual([
      ['Pendiente con tiempo', 'Lunes', true, 900],
      ['Pendiente sin tiempo', 'Martes', false, 0],
    ]);
  });

  it('semana sin nada', () => {
    const s = summary({ tasks: [], sessions: [], tagIdsByTask: new Map(), previousLoggedSeconds: 0 });
    expect(s).toMatchObject({
      completedCount: 0,
      totalCount: 0,
      loggedSeconds: 0,
      byContext: [],
      byTag: [],
      unfinished: [],
    });
  });
});
