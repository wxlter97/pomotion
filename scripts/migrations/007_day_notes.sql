-- Notas del día / bitácora (ROADMAP.md §11 Tier 2): texto libre por día,
-- aparte de las tareas. Una nota por usuario y por fecha del calendario — no
-- se scopea por contexto (Trabajo/Casa), es la bitácora del día entero.

CREATE TABLE day_notes (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,               -- 'YYYY-MM-DD'
  body       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date)
);
