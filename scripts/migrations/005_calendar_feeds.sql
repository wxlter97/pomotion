-- Suscripción a calendarios iCal (ROADMAP.md §9): el usuario registra una URL
-- .ics, el server la baja cada tanto y materializa los eventos como tareas.
-- Sync unidireccional (calendario -> pomotion), nunca al revés.

CREATE TABLE calendar_feeds (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  url            TEXT NOT NULL,            -- webcal/https .ics; se trata como credencial (no se loguea)
  file           TEXT,                     -- bucket destino: 'Trabajo' / 'Casa' / NULL
  enabled        INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,                     -- ISO; NULL = nunca
  last_error     TEXT,                     -- último error de sync (sin la URL)
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_calendar_feeds_user ON calendar_feeds(user_id);

-- Procedencia de la tarea. Las tareas manuales quedan 'manual' por defecto.
ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';  -- 'manual' | 'calendar'
ALTER TABLE tasks ADD COLUMN feed_id TEXT;                           -- calendario de origen (NULL si se huerfanizó)
ALTER TABLE tasks ADD COLUMN external_uid TEXT;                      -- UID del VEVENT (+ '::' + RECURRENCE-ID en recurrentes)
ALTER TABLE tasks ADD COLUMN external_date TEXT;                     -- fecha que dijo el calendario en el último sync

CREATE INDEX idx_tasks_feed ON tasks(feed_id, external_uid);
