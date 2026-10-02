import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../scripts/migrate.js';
import { upsertUserFromGoogle } from './authRepo.js';
import { adsFreePriceCents, applyApprovedPayment, createPendingPayment, deletePayment } from './billingRepo.js';
import { resetDb, setDb } from './db.js';

let db: Client;
let userId: string;

beforeEach(async () => {
  db = createClient({ url: ':memory:' });
  await runMigrations(db, { log: () => {} });
  setDb(db);
  userId = (await upsertUserFromGoogle({ googleSub: 's1', email: 'a@gmail.com', name: 'A', pictureUrl: null })).id;
});

afterEach(() => resetDb());

async function adsFreeAt(): Promise<string | null> {
  const r = await db.execute({ sql: 'SELECT ads_free_at FROM users WHERE id = ?', args: [userId] });
  return r.rows[0].ads_free_at as string | null;
}

describe('adsFreePriceCents', () => {
  it('default $1.99, configurable por entorno, ignora valores inválidos', () => {
    expect(adsFreePriceCents({})).toBe(199);
    expect(adsFreePriceCents({ ADS_FREE_PRICE_CENTS: '299' })).toBe(299);
    expect(adsFreePriceCents({ ADS_FREE_PRICE_CENTS: '0' })).toBe(199);
    expect(adsFreePriceCents({ ADS_FREE_PRICE_CENTS: 'abc' })).toBe(199);
  });
});

describe('applyApprovedPayment', () => {
  it('un cobro exitoso deja al usuario sin anuncios', async () => {
    const p = await createPendingPayment(userId, 199);
    expect(await adsFreeAt()).toBeNull();
    expect(await applyApprovedPayment({ reference: p.id, transactionId: 'tx1', amountCents: 199 })).toBe('activated');
    expect(await adsFreeAt()).not.toBeNull();
  });

  it('es idempotente: reintentar el mismo aviso no cambia nada', async () => {
    const p = await createPendingPayment(userId, 199);
    await applyApprovedPayment({ reference: p.id, transactionId: 'tx1', amountCents: 199 });
    const first = await adsFreeAt();
    expect(await applyApprovedPayment({ reference: p.id, transactionId: 'tx1', amountCents: 199 })).toBe('duplicate');
    expect(await adsFreeAt()).toBe(first);
  });

  it('un transaction_id ya usado en otro pago no activa', async () => {
    const a = await createPendingPayment(userId, 199);
    const b = await createPendingPayment(userId, 199);
    await applyApprovedPayment({ reference: a.id, transactionId: 'tx1', amountCents: 199 });
    expect(await applyApprovedPayment({ reference: b.id, transactionId: 'tx1', amountCents: 199 })).toBe('duplicate');
  });

  it('no activa con monto menor al precio, monto ilegible o referencia desconocida', async () => {
    const p = await createPendingPayment(userId, 199);
    expect(await applyApprovedPayment({ reference: p.id, transactionId: 'tx1', amountCents: 100 })).toBe('amount_too_low');
    expect(await applyApprovedPayment({ reference: p.id, transactionId: 'tx1', amountCents: null })).toBe('amount_too_low');
    expect(await applyApprovedPayment({ reference: 'otra', transactionId: 'tx2', amountCents: 199 })).toBe('unknown_reference');
    expect(await adsFreeAt()).toBeNull();
  });

  it('un enlace cancelado (borrado) ya no se puede aplicar', async () => {
    const p = await createPendingPayment(userId, 199);
    await deletePayment(p.id);
    expect(await applyApprovedPayment({ reference: p.id, transactionId: 'tx1', amountCents: 199 })).toBe('unknown_reference');
  });
});
