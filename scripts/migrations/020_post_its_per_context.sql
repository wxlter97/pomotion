-- Los post-its pasan a ser por espacio/contexto (antes eran un tablero
-- global, compartido entre todos los espacios). Mismo patrón que
-- `day_notes.file_key`: '' = "sin contexto" (en vez de NULL). Los que ya
-- existían quedan en ese espacio por defecto.

ALTER TABLE post_its ADD COLUMN file_key TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_post_its_user_file ON post_its(user_id, file_key);
