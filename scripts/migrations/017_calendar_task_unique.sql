-- Un evento de calendario = una tarea por feed. Dos syncs del mismo feed
-- corriendo a la vez (p. ej. dos pestañas, o "Sincronizar" + el sync al
-- abrir) planificaban cada uno el mismo `create` y se insertaba dos veces.
-- El índice único hace que el segundo INSERT (OR IGNORE) no haga nada.
--
-- Antes hay que limpiar los duplicados que ya existan. Por cada grupo se
-- queda la tarea con historial (sesiones), después la hecha, después la más
-- vieja. Del resto: las que tienen sesiones o están hechas se desvinculan
-- del feed (feed_id = NULL, igual que cuando un evento desaparece), para no
-- perder historial por el CASCADE; las demás se borran.

UPDATE tasks SET feed_id = NULL
WHERE id IN (
  SELECT id FROM (
    SELECT t.id,
           ROW_NUMBER() OVER (
             PARTITION BY t.user_id, t.feed_id, t.external_uid
             ORDER BY EXISTS (SELECT 1 FROM work_sessions ws WHERE ws.task_id = t.id) DESC,
                      t.done DESC, t.created_at, t.id
           ) AS rn
    FROM tasks t
    WHERE t.feed_id IS NOT NULL AND t.external_uid IS NOT NULL
  )
  WHERE rn > 1
)
AND (done = 1 OR EXISTS (SELECT 1 FROM work_sessions ws WHERE ws.task_id = tasks.id));

DELETE FROM task_tags
WHERE task_id IN (
  SELECT id FROM (
    SELECT t.id,
           ROW_NUMBER() OVER (
             PARTITION BY t.user_id, t.feed_id, t.external_uid
             ORDER BY EXISTS (SELECT 1 FROM work_sessions ws WHERE ws.task_id = t.id) DESC,
                      t.done DESC, t.created_at, t.id
           ) AS rn
    FROM tasks t
    WHERE t.feed_id IS NOT NULL AND t.external_uid IS NOT NULL
  )
  WHERE rn > 1
);

DELETE FROM tasks
WHERE id IN (
  SELECT id FROM (
    SELECT t.id,
           ROW_NUMBER() OVER (
             PARTITION BY t.user_id, t.feed_id, t.external_uid
             ORDER BY EXISTS (SELECT 1 FROM work_sessions ws WHERE ws.task_id = t.id) DESC,
                      t.done DESC, t.created_at, t.id
           ) AS rn
    FROM tasks t
    WHERE t.feed_id IS NOT NULL AND t.external_uid IS NOT NULL
  )
  WHERE rn > 1
);

CREATE UNIQUE INDEX idx_tasks_feed_uid_unique
  ON tasks(user_id, feed_id, external_uid)
  WHERE feed_id IS NOT NULL;
