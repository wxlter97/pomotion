-- Post-its: tablero de notas sueltas de texto libre, independiente del
-- calendario (a diferencia de day_notes, que es una por día). Se pueden
-- fijar (pinned) para que floten arriba de la lista.

CREATE TABLE post_its (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT 'amber',
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_post_its_user ON post_its(user_id);
