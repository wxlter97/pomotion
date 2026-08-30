-- Plantillas de día con horario (ROADMAP §11 Tier 4): un ítem de plantilla
-- puede llevar la hora planeada de la tarea original, para que "Aplicar"
-- deje el día directamente agendado en el timeline.
ALTER TABLE day_template_items ADD COLUMN planned_start TEXT; -- 'HH:MM' (zero-padded); NULL = sin horario
