import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Identidad del usuario autenticado de la request actual, sin pasarla como
 * parámetro por cada método del `Store` y cada handler. `withAuth`
 * (ver handler.ts) hace `runWithUser` una sola vez por request, ya con la
 * fila del usuario resuelta de la sesión.
 */
export type RequestUser = { userId: string; isAdmin: boolean };

const als = new AsyncLocalStorage<RequestUser>();

export function runWithUser<T>(user: RequestUser, fn: () => Promise<T>): Promise<T> {
  return als.run(user, fn);
}

/** La identidad del usuario actual. Lanza si no se llamó dentro de `withAuth`. */
export function currentUser(): RequestUser {
  const user = als.getStore();
  if (!user) {
    throw new Error('No hay usuario en el contexto de la request (¿falta withAuth?)');
  }
  return user;
}

export function currentUserId(): string {
  return currentUser().userId;
}
