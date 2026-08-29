-- Plantillas de día: un set de tareas con nombre que se puede "estampar"
-- en un día (ROADMAP.md §9, tier 3).

CREATE TABLE day_templates (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  file       TEXT,                     -- contexto opcional (Trabajo / Casa / NULL)
  created_at TEXT NOT NULL
);
CREATE INDEX idx_day_templates_user ON day_templates(user_id);

CREATE TABLE day_template_items (
  id           TEXT PRIMARY KEY,
  template_id  TEXT NOT NULL REFERENCES day_templates(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  "order"      REAL NOT NULL DEFAULT 0,
  priority     TEXT,                   -- NULL / 'low' / 'med' / 'high'
  estimate_min INTEGER
);
CREATE INDEX idx_day_template_items_template ON day_template_items(template_id);
