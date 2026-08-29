import type { VercelResponse } from '@vercel/node';

/**
 * Errores de dominio que la capa de store (notionStore.ts) lanza y los
 * endpoints traducen a respuestas HTTP. Así la lógica de negocio no
 * depende del objeto `res` de Vercel y se puede testear / portar a otro
 * backend sin arrastrar el transporte.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 400 — la request no cumple una precondición (campos faltantes o inválidos). */
export class BadRequestError extends ApiError {
  constructor(code: string, message: string) {
    super(400, code, message);
  }
}

/** 404 — el recurso pedido (ej. una semana por label) no existe. */
export class NotFoundError extends ApiError {
  constructor(code: string, message: string) {
    super(404, code, message);
  }
}

/** 409 — el estado actual impide la operación (ej. la semana ya existe). */
export class ConflictError extends ApiError {
  constructor(code: string, message: string) {
    super(409, code, message);
  }
}

/** 502 — Notion (u otro upstream) respondió algo inesperado. */
export class UpstreamError extends ApiError {
  constructor(code: string, message: string) {
    super(502, code, message);
  }
}

/**
 * Traduce cualquier error a una respuesta JSON. Un ApiError lleva su
 * status/code; cualquier otra cosa es un 500 con el mensaje original
 * (y se loguea, porque no estaba previsto).
 */
export function sendError(res: VercelResponse, err: unknown): VercelResponse {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  console.error(err);
  const message = err instanceof Error ? err.message : 'Error desconocido';
  return res.status(500).json({ error: 'internal_error', message });
}
