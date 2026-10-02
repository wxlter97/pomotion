-- "Quitar anuncios": pago único (Wompi) asociado al usuario de por vida.
-- `users.ads_free_at` != NULL = ya pagó. `payments` guarda cada intento de
-- cobro: se crea en 'pending' ANTES de mandar al usuario al checkout, así el
-- webhook puede correlacionarlo por `reference` (= identificadorEnlaceComercio
-- en Wompi) y `transaction_id` único hace idempotente un reintento del aviso.

ALTER TABLE users ADD COLUMN ads_free_at TEXT;

CREATE TABLE payments (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product        TEXT NOT NULL,
  amount_cents   INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  provider_link_id TEXT,
  transaction_id TEXT UNIQUE,
  created_at     TEXT NOT NULL,
  paid_at        TEXT
);
CREATE INDEX idx_payments_user ON payments(user_id);
