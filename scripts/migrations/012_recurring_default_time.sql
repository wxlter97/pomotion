-- Recurrentes con hora por defecto (ROADMAP §11 Tier 4): las tareas que
-- genera una regla nacen con esta hora ya puesta en `tasks.planned_start`,
-- sin tener que agendarlas a mano en el timeline cada semana.
ALTER TABLE recurring_rules ADD COLUMN default_planned_start TEXT; -- 'HH:MM' (zero-padded); NULL = sin horario por defecto
