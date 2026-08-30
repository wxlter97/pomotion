-- Subtareas / checklist de una tarea (ROADMAP.md §11 Tier 2): pasos marcables
-- dentro de una tarea, sin tiempo propio. Se guardan como JSON en una sola
-- columna — no hay tabla aparte porque nunca se consultan ni agregan por sí
-- solos, siempre viajan con la tarea.

ALTER TABLE tasks ADD COLUMN checklist TEXT;  -- JSON [{id,text,done}]; NULL = sin checklist
