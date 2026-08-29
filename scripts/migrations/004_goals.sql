-- Metas: "X horas en [etiqueta] este mes" (ROADMAP.md §9, tier 3).
-- v1: solo mensuales, evaluadas contra el mes en curso.

CREATE TABLE goals (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id         TEXT REFERENCES tags(id) ON DELETE CASCADE,  -- NULL = todo el contexto
  file           TEXT,                                        -- contexto opcional
  target_minutes INTEGER NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_goals_user ON goals(user_id);
