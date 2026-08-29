-- Recurrentes automáticas: marca las semanas en las que ya se materializaron
-- las reglas recurrentes. La vista semanal las aplica una sola vez por semana
-- (y por contexto), así no repone una tarea recurrente que el usuario borró a
-- mano ni duplica al recargar.

CREATE TABLE recurring_runs (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,               -- lunes 'YYYY-MM-DD'
  file_key   TEXT NOT NULL,               -- file, o '' cuando no hay contexto
  applied_at TEXT NOT NULL,
  PRIMARY KEY (user_id, week_start, file_key)
);
