-- Time-blocking v1 "blando" (ROADMAP.md §11 Tier 3): hora planeada por
-- tarea, sin bloque de duración ni vista de agenda todavía. Habilita el
-- chip de hora en la fila y ordenar el día por hora planeada.
ALTER TABLE tasks ADD COLUMN planned_start TEXT; -- 'HH:MM' (zero-padded); NULL = sin horario planeado
