/**
 * Pago único "quitar anuncios". Tablas `payments` + `users.ads_free_at`
 * (migración 019). Infraestructura de cobro, separada del `Store` de
 * dominio, igual que authRepo.
 */
import crypto from 'node:crypto';
import { getDb } from './db.js';

export const ADS_FREE_PRODUCT = 'ads_free';

/** Precio del pago único en centavos de dólar (default $1.99). */
export function adsFreePriceCents(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.ADS_FREE_PRICE_CENTS);
  return Number.isInteger(n) && n > 0 ? n : 199;
}

export type PendingPayment = { id: string; amountCents: number };

export async function createPendingPayment(userId: string, amountCents: number): Promise<PendingPayment> {
  const id = crypto.randomUUID();
  await getDb().execute({
    sql: `INSERT INTO payments (id, user_id, product, amount_cents, status, created_at)
          VALUES (?, ?, ?, ?, 'pending', ?)`,
    args: [id, userId, ADS_FREE_PRODUCT, amountCents, new Date().toISOString()],
  });
  return { id, amountCents };
}

export async function setPaymentLink(paymentId: string, linkId: string): Promise<void> {
  await getDb().execute({
    sql: 'UPDATE payments SET provider_link_id = ? WHERE id = ?',
    args: [linkId, paymentId],
  });
}

/** Si el proveedor falló al crear el enlace no queda un 'pending' huérfano. */
export async function deletePayment(paymentId: string): Promise<void> {
  await getDb().execute({ sql: "DELETE FROM payments WHERE id = ? AND status = 'pending'", args: [paymentId] });
}

export type ApplyResult = 'activated' | 'duplicate' | 'unknown_reference' | 'amount_too_low';

/**
 * Aplica un cobro exitoso: marca el pago como pagado y deja al usuario sin
 * anuncios. Idempotente por `transactionId` (único): un reintento del mismo
 * aviso devuelve 'duplicate' sin tocar nada. Si el monto cobrado es menor al
 * esperado NO activa — evita regalar el beneficio con un aviso armado a mano.
 */
export async function applyApprovedPayment(input: {
  reference: string;
  transactionId: string;
  amountCents: number | null;
}): Promise<ApplyResult> {
  const db = getDb();
  const found = await db.execute({
    sql: "SELECT id, user_id, amount_cents, status FROM payments WHERE id = ? AND product = ?",
    args: [input.reference, ADS_FREE_PRODUCT],
  });
  if (found.rows.length === 0) return 'unknown_reference';
  const row = found.rows[0];

  if (input.amountCents === null || input.amountCents < Number(row.amount_cents)) {
    return 'amount_too_low';
  }

  const now = new Date().toISOString();
  // El UPDATE condicionado a 'pending' + el UNIQUE de transaction_id hacen
  // que dos avisos simultáneos del mismo cobro solo activen una vez.
  try {
    const res = await db.execute({
      sql: `UPDATE payments SET status = 'paid', transaction_id = ?, paid_at = ?
            WHERE id = ? AND status = 'pending'`,
      args: [input.transactionId, now, input.reference],
    });
    if (res.rowsAffected === 0) return 'duplicate';
  } catch {
    return 'duplicate'; // transaction_id ya registrado
  }
  await db.execute({
    sql: 'UPDATE users SET ads_free_at = COALESCE(ads_free_at, ?) WHERE id = ?',
    args: [now, String(row.user_id)],
  });
  return 'activated';
}
