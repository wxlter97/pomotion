-- Time-blocking v2 (ROADMAP.md §11 Tier 3): duración propia del bloque,
-- para poder redimensionarlo en el timeline sin tocar la estimación de la
-- tarea. NULL sigue usando la estimación (o el default del timeline) como
-- largo del bloque.
ALTER TABLE tasks ADD COLUMN planned_minutes INTEGER; -- minutos; NULL = usa estimate_min o el default
