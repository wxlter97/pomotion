-- Recurrencia mensual (ROADMAP.md §11 Tier 2): hasta ahora `recurring_rules`
-- solo materializaba por día de semana. Se agrega `freq`:
--   'weekly'  → usa `weekdays` (CSV 1..7), como antes.
--   'monthly' → usa `monthdays` (CSV de días del mes 1..31, y -1 = último día).
-- Las reglas existentes quedan 'weekly' por el DEFAULT.

ALTER TABLE recurring_rules ADD COLUMN freq TEXT NOT NULL DEFAULT 'weekly';  -- 'weekly' | 'monthly'
ALTER TABLE recurring_rules ADD COLUMN monthdays TEXT;                       -- CSV 1..31 (+ -1 = último día); NULL para reglas weekly
