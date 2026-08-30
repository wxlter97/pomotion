-- Foco de la semana: una nota corta de intención por semana (paso 3 de la
-- Revisión semanal, ROADMAP §11). Una fila por (usuario, lunes de la semana).
CREATE TABLE week_focus (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL, -- 'YYYY-MM-DD', siempre un lunes
  body       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, week_start)
);
