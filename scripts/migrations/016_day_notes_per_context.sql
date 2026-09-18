-- La nota del día pasa a ser por espacio/contexto (antes era una sola por
-- usuario+fecha, compartida entre todos los espacios). Mismo patrón que
-- `recurring_runs.file_key`: columna NOT NULL con '' para "sin contexto",
-- en vez de NULL, porque SQLite trata cada NULL como distinto en una PK/
-- UNIQUE compuesta y el upsert (ON CONFLICT) dejaría de funcionar.
--
-- Rebuild de tabla porque SQLite no soporta ALTER de la primary key. Las
-- notas existentes quedan en el contexto por defecto (file_key '').

CREATE TABLE day_notes_new (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  file_key   TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date, file_key)
);

INSERT INTO day_notes_new (user_id, date, file_key, body, updated_at)
SELECT user_id, date, '', body, updated_at FROM day_notes;

DROP TABLE day_notes;
ALTER TABLE day_notes_new RENAME TO day_notes;
