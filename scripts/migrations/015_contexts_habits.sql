-- Contextos como entidad propia (antes solo se derivaban de `tasks.file`) +
-- hábitos: un contexto puede ser de tipo 'task' (tablero normal) o 'habit'
-- (lista de hábitos con check diario y racha).
--
-- `contexts.id` es el mismo string que ya se usa como `tasks.file` /
-- `FileEntry.id` en el resto del esquema (no es un uuid nuevo) — así los
-- contextos "de tarea" existentes (implícitos, solo por tener tareas con ese
-- `file`) no necesitan ningún backfill para seguir funcionando igual.

CREATE TABLE contexts (
  id         TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL DEFAULT 'task',  -- 'task' | 'habit'
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE habits (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT 'amber',
  archived   INTEGER NOT NULL DEFAULT 0,
  "order"    REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id, context_id) REFERENCES contexts(user_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_habits_user_context ON habits(user_id, context_id);

CREATE TABLE habit_logs (
  habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date     TEXT NOT NULL,  -- 'YYYY-MM-DD'
  PRIMARY KEY (habit_id, date)
);
CREATE INDEX idx_habit_logs_habit ON habit_logs(habit_id);
