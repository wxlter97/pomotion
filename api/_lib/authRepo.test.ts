import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../scripts/migrate.js';
import { resetDb, setDb } from './db.js';
import {
  approveUserByEmail,
  createAuthSession,
  deleteAuthSession,
  getUserBySessionToken,
  listPendingUsers,
  listUsersForAdmin,
  putOAuthState,
  setUserApproval,
  takeOAuthState,
  upsertUserFromGoogle,
} from './authRepo.js';

let db: Client;

beforeEach(async () => {
  db = createClient({ url: ':memory:' });
  await runMigrations(db, { log: () => {} });
  setDb(db);
  delete process.env.SEED_ADMIN_EMAIL;
});

afterEach(() => {
  resetDb();
  vi.useRealTimers();
});

const GOOGLE = { googleSub: 'sub-1', email: 'ana@gmail.com', name: 'Ana', pictureUrl: 'http://p/a.png' };

describe('upsertUserFromGoogle', () => {
  it('crea el usuario en el primer login (pendiente, no admin)', async () => {
    const user = await upsertUserFromGoogle(GOOGLE);
    expect(user.email).toBe('ana@gmail.com');
    expect(user.approvedLogin).toBe(false);
    expect(user.isAdmin).toBe(false);
    expect(user.id).toMatch(/[0-9a-f-]{36}/);
  });

  it('el segundo login con el mismo google_sub actualiza, no duplica', async () => {
    const a = await upsertUserFromGoogle(GOOGLE);
    const b = await upsertUserFromGoogle({ ...GOOGLE, name: 'Ana María', email: 'ana2@gmail.com' });
    expect(b.id).toBe(a.id);
    expect(b.name).toBe('Ana María');
    expect(b.email).toBe('ana2@gmail.com');
    expect((await db.execute('SELECT count(*) c FROM users')).rows[0].c).toBe(1);
  });

  it('SEED_ADMIN_EMAIL entra aprobado y admin', async () => {
    process.env.SEED_ADMIN_EMAIL = 'ANA@gmail.com'; // case-insensitive
    const user = await upsertUserFromGoogle(GOOGLE);
    expect(user.approvedLogin).toBe(true);
    expect(user.isAdmin).toBe(true);
  });

  it('un usuario ya aprobado no se des-aprueba en el siguiente login', async () => {
    await upsertUserFromGoogle(GOOGLE);
    await approveUserByEmail('ana@gmail.com');
    const after = await upsertUserFromGoogle(GOOGLE);
    expect(after.approvedLogin).toBe(true);
  });
});

describe('sesiones', () => {
  it('createAuthSession → getUserBySessionToken devuelve el usuario', async () => {
    const user = await upsertUserFromGoogle(GOOGLE);
    const token = await createAuthSession(user.id, 'test-agent');
    const found = await getUserBySessionToken(token);
    expect(found?.id).toBe(user.id);
  });

  it('token inexistente → null', async () => {
    expect(await getUserBySessionToken('no-existe')).toBeNull();
  });

  it('sesión expirada → null', async () => {
    const user = await upsertUserFromGoogle(GOOGLE);
    const token = await createAuthSession(user.id, null);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000); // +31 días
    expect(await getUserBySessionToken(token)).toBeNull();
  });

  it('deleteAuthSession invalida el token', async () => {
    const user = await upsertUserFromGoogle(GOOGLE);
    const token = await createAuthSession(user.id, null);
    await deleteAuthSession(token);
    expect(await getUserBySessionToken(token)).toBeNull();
  });
});

describe('oauth_state', () => {
  it('takeOAuthState devuelve el verifier y lo borra (uso único)', async () => {
    await putOAuthState({ state: 's1', codeVerifier: 'v1', redirectTo: '/x' });
    const first = await takeOAuthState('s1');
    expect(first).toEqual({ codeVerifier: 'v1', redirectTo: '/x' });
    expect(await takeOAuthState('s1')).toBeNull();
  });

  it('state expirado → null', async () => {
    await putOAuthState({ state: 's2', codeVerifier: 'v2', redirectTo: null });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    expect(await takeOAuthState('s2')).toBeNull();
  });
});

describe('aprobación', () => {
  it('listPendingUsers lista solo los no aprobados; approveUserByEmail los saca', async () => {
    await upsertUserFromGoogle(GOOGLE);
    await upsertUserFromGoogle({ ...GOOGLE, googleSub: 'sub-2', email: 'beto@gmail.com', name: 'Beto' });
    expect((await listPendingUsers()).map((u) => u.email).sort()).toEqual(['ana@gmail.com', 'beto@gmail.com']);

    expect(await approveUserByEmail('ANA@GMAIL.COM')).toBe(true);
    expect((await listPendingUsers()).map((u) => u.email)).toEqual(['beto@gmail.com']);
    expect(await approveUserByEmail('nadie@gmail.com')).toBe(false);
  });

  it('listUsersForAdmin trae a todos, pendientes primero', async () => {
    const ana = await upsertUserFromGoogle(GOOGLE);
    await upsertUserFromGoogle({ ...GOOGLE, googleSub: 'sub-2', email: 'beto@gmail.com', name: 'Beto' });
    await setUserApproval(ana.id, true);

    const all = await listUsersForAdmin();
    expect(all).toHaveLength(2);
    expect(all[0].email).toBe('beto@gmail.com'); // pendiente primero
    expect(all[0].approvedLogin).toBe(false);
    expect(all[1].approvedLogin).toBe(true);
  });

  it('setUserApproval aprueba y revoca por id', async () => {
    const ana = await upsertUserFromGoogle(GOOGLE);
    expect(await setUserApproval(ana.id, true)).toBe(true);
    expect((await listPendingUsers())).toHaveLength(0);
    expect(await setUserApproval(ana.id, false)).toBe(true);
    expect((await listPendingUsers()).map((u) => u.email)).toEqual(['ana@gmail.com']);
    expect(await setUserApproval('no-existe', true)).toBe(false);
  });
});
