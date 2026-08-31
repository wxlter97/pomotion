-- Recordar los eventos de calendario que el usuario borró a propósito
-- (ROADMAP §11 Tier 4): borrar una tarea no deja rastro de que existió, así
-- que sin esto el próximo sync la volvía a crear (el evento seguía vivo en
-- el feed). `planSync` salta un `create` si el UID está acá.
CREATE TABLE calendar_deleted_events (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feed_id      TEXT NOT NULL,          -- sin FK: mismo criterio que tasks.feed_id
  external_uid TEXT NOT NULL,
  deleted_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, feed_id, external_uid)
);
