-- pomotion — schema inicial (Turso / libSQL / SQLite).
-- Ver ROADMAP.md §3. Fechas como texto ISO-8601; 'YYYY-MM-DD' para días.

-- --- Auth ---

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  name           TEXT,
  picture_url    TEXT,
  google_sub     TEXT UNIQUE NOT NULL,
  approved_login INTEGER NOT NULL DEFAULT 0,
  is_admin       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  last_seen_at   TEXT
);

CREATE TABLE auth_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE oauth_state (
  state         TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  redirect_to   TEXT,
  created_at    TEXT NOT NULL
);

-- --- Dominio ---

CREATE TABLE recurring_rules (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  file       TEXT,
  weekdays   TEXT NOT NULL DEFAULT '1,2,3,4,5',  -- CSV de 1(Lun)..7(Dom)
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_recurring_rules_user ON recurring_rules(user_id);

CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  date              TEXT,                          -- 'YYYY-MM-DD'; NULL = backlog / inbox
  done              INTEGER NOT NULL DEFAULT 0,
  "order"           REAL NOT NULL DEFAULT 0,        -- orden fraccional dentro del día
  file              TEXT,                          -- contexto: 'Trabajo' / 'Casa' / NULL
  priority          TEXT,                          -- NULL / 'low' / 'med' / 'high'
  estimate_min      INTEGER,
  notes             TEXT,
  due               TEXT,                          -- 'YYYY-MM-DD', vencimiento != agenda
  recurring_rule_id TEXT REFERENCES recurring_rules(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_tasks_user_date ON tasks(user_id, date);
CREATE INDEX idx_tasks_user_file_date ON tasks(user_id, file, date);

CREATE TABLE work_sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  duration_sec INTEGER NOT NULL,
  start_hhmm   TEXT NOT NULL,                      -- 'HH:MM'
  end_hhmm     TEXT NOT NULL,
  date         TEXT NOT NULL,                      -- denormalizado de la tarea; se actualiza al mover
  file         TEXT,                              -- denormalizado
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_ws_user_date ON work_sessions(user_id, date);
CREATE INDEX idx_ws_user_task ON work_sessions(user_id, task_id);

CREATE TABLE tags (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  color   TEXT,
  UNIQUE(user_id, name)
);

CREATE TABLE task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
