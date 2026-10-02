/**
 * Cliente mínimo de Wompi El Salvador (docs.wompi.sv) — portado de
 * `apps/billing/providers.py` de porksupuesto, pero solo lo que Pomotion usa:
 * un `EnlacePago` único (pago de una sola vez) y la verificación del webhook.
 *
 * - Auth: OAuth2 *client credentials* con el App ID y el API Secret.
 * - El enlace lleva nuestra referencia en `identificadorEnlaceComercio`, que
 *   vuelve en el webhook (`EnlacePago.IdentificadorEnlaceComercio`).
 * - Webhook: header `wompi_hash` = HMAC-SHA256 hex del cuerpo CRUDO con el
 *   API Secret. Wompi solo avisa de cobros exitosos.
 */
import crypto from 'node:crypto';

const TIMEOUT_MS = 15_000;

export class WompiError extends Error {}

export type WompiConfig = {
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  authUrl: string;
  /** Aceptar avisos de pagos de prueba (EsProductiva = false). Solo sandbox. */
  acceptTestPayments: boolean;
};

export function wompiConfig(env: NodeJS.ProcessEnv = process.env): WompiConfig {
  return {
    // `.trim()`: un espacio o salto de línea de más al copiar del panel de
    // Wompi da un 401/403 sin explicación mejor.
    clientId: (env.WOMPI_CLIENT_ID ?? '').trim(),
    clientSecret: (env.WOMPI_CLIENT_SECRET ?? '').trim(),
    apiUrl: (env.WOMPI_API_URL ?? 'https://api.wompi.sv').replace(/\/$/, ''),
    authUrl: env.WOMPI_AUTH_URL ?? 'https://id.wompi.sv/connect/token',
    acceptTestPayments: env.WOMPI_ACCEPT_TEST_PAYMENTS === 'true',
  };
}

// Token en memoria de la instancia: dura ~1 h y la doc pide no pedir uno por llamada.
let tokenCache: { value: string; expiresAt: number } = { value: '', expiresAt: 0 };

/** Solo para tests. */
export function resetWompiTokenCache(): void {
  tokenCache = { value: '', expiresAt: 0 };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new WompiError(`No se pudo contactar a Wompi: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function getToken(cfg: WompiConfig): Promise<string> {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new WompiError('Faltan WOMPI_CLIENT_ID / WOMPI_CLIENT_SECRET.');
  }
  const res = await fetchWithTimeout(cfg.authUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      audience: 'wompi_api',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  });
  if (!res.ok) {
    throw new WompiError(`Wompi rechazó las credenciales (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
  const data = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!data?.access_token) throw new WompiError('Wompi no devolvió un access_token.');
  // Un minuto de margen para no usar un token que caduca a mitad de la llamada.
  tokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max((data.expires_in ?? 3600) - 60, 0) * 1000,
  };
  return data.access_token;
}

export type PaymentLinkInput = {
  /** Nuestra referencia: vuelve en el webhook. */
  reference: string;
  amountCents: number;
  productName: string;
  redirectUrl: string;
  returnUrl: string;
  webhookUrl?: string;
};

export type PaymentLink = { url: string; linkId: string };

/** Crea el enlace de pago único. Monto y cantidad NO editables: si no, se
 *  podría pagar menos que el precio. */
export async function createPaymentLink(
  input: PaymentLinkInput,
  cfg: WompiConfig = wompiConfig()
): Promise<PaymentLink> {
  const configuracion: Record<string, unknown> = {
    urlRedirect: input.redirectUrl,
    urlRetorno: input.returnUrl,
    esMontoEditable: false,
    esCantidadEditable: false,
  };
  if (input.webhookUrl) configuracion.urlWebhook = input.webhookUrl;

  const res = await fetchWithTimeout(`${cfg.apiUrl}/EnlacePago`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await getToken(cfg)}`,
    },
    body: JSON.stringify({
      identificadorEnlaceComercio: input.reference,
      monto: Math.round(input.amountCents) / 100,
      nombreProducto: input.productName,
      configuracion,
    }),
  });
  if (res.status === 401) tokenCache = { value: '', expiresAt: 0 }; // pudo caducar antes de lo previsto
  if (!res.ok) throw new WompiError(`Wompi respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = (await res.json().catch(() => null)) as
    | { urlEnlace?: string; urlEnlaceLargo?: string; idEnlace?: number | string }
    | null;
  const url = data?.urlEnlace || data?.urlEnlaceLargo;
  if (!url) throw new WompiError('Wompi no devolvió la URL del enlace de pago.');
  return { url, linkId: String(data?.idEnlace ?? '') };
}

/** Compara la firma del header `wompi_hash` contra el HMAC del cuerpo crudo. */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  clientSecret: string
): boolean {
  const given = (signature ?? '').trim().toLowerCase();
  if (!given || !clientSecret) return false;
  const expected = crypto.createHmac('sha256', clientSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type WompiPayment = {
  /** Nuestra referencia (`payments.id`). */
  reference: string;
  transactionId: string;
  amountCents: number | null;
  email: string;
};

/** Normaliza el aviso. `null` = hay que ignorarlo (no exitoso, o de prueba
 *  sin `acceptTestPayments`). */
export function parseWebhookBody(rawBody: string, cfg: WompiConfig = wompiConfig()): WompiPayment | null {
  let body: Record<string, any>;
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    body = parsed;
  } catch {
    return null;
  }

  const approved = String(body.ResultadoTransaccion ?? '').toLowerCase().startsWith('exitosa');
  const productive = body.EsProductiva ?? body.esProductiva;
  const isTest = productive === false;
  if (!approved || (isTest && !cfg.acceptTestPayments)) return null;

  const amount = Number(body.Monto);
  return {
    reference: String(body.EnlacePago?.IdentificadorEnlaceComercio ?? ''),
    transactionId: String(body.IdTransaccion ?? ''),
    amountCents: Number.isFinite(amount) ? Math.round(amount * 100) : null,
    email: String(body.cliente?.Email ?? ''),
  };
}
