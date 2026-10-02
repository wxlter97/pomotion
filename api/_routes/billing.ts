import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withAuth } from '../_lib/handler.js';
import {
  ADS_FREE_PRODUCT,
  adsFreePriceCents,
  applyApprovedPayment,
  createPendingPayment,
  deletePayment,
  setPaymentLink,
} from '../_lib/billingRepo.js';
import {
  WompiError,
  createPaymentLink,
  parseWebhookBody,
  verifyWebhookSignature,
  wompiConfig,
} from '../_lib/wompi.js';

/**
 * Pago único "quitar anuncios" con Wompi. Dos entradas:
 * - `POST /api/billing` (con sesión) — crea el pago en 'pending' y el
 *   enlace de Wompi; responde `{ url }` para redirigir al usuario.
 * - `POST /api/billing?webhook=1` (sin sesión, firmado) — aviso de Wompi.
 *
 * El estado ("¿ya pagó?") viaja en `GET /api/auth/status` → `user.adsFree`.
 */

// El HMAC se calcula sobre el cuerpo CRUDO: el enrutador (`api/[...path].ts`)
// lo deja en `req.rawBody` antes de parsear el JSON.
function readRawBody(req: VercelRequest): string {
  const raw = (req as VercelRequest & { rawBody?: string }).rawBody;
  return typeof raw === 'string' ? raw : '';
}

const checkout = withAuth(async (req, res, user) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (user.adsFreeAt) {
    return res.status(409).json({ error: 'already_paid', message: 'Ya quitaste los anuncios.' });
  }

  const baseUrl = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('APP_BASE_URL no está configurada');

  const payment = await createPendingPayment(user.id, adsFreePriceCents());
  try {
    const link = await createPaymentLink({
      reference: payment.id,
      amountCents: payment.amountCents,
      productName: 'Pomotion · sin anuncios',
      redirectUrl: `${baseUrl}/?pago=ok`,
      returnUrl: `${baseUrl}/?pago=cancelado`,
      webhookUrl: process.env.WOMPI_WEBHOOK_URL || `${baseUrl}/api/billing?webhook=1`,
    });
    await setPaymentLink(payment.id, link.linkId);
    return res.status(200).json({ url: link.url });
  } catch (err) {
    await deletePayment(payment.id);
    if (err instanceof WompiError) {
      console.error(err);
      return res.status(502).json({ error: 'payment_provider_error', message: 'No se pudo iniciar el pago. Probá de nuevo en un rato.' });
    }
    throw err;
  }
});

async function webhook(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const cfg = wompiConfig();
  const raw = readRawBody(req);
  const signature = req.headers['wompi_hash'] ?? req.headers['wompi-hash'];
  if (!verifyWebhookSignature(raw, Array.isArray(signature) ? signature[0] : signature, cfg.clientSecret)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  const payment = parseWebhookBody(raw, cfg);
  if (!payment) return res.status(200).json({ ok: true, ignored: true });

  const result = await applyApprovedPayment(payment);
  if (result === 'unknown_reference' || result === 'amount_too_low') {
    // Se contesta 200 para que Wompi no reintente eternamente un aviso que
    // no vamos a poder aplicar; queda en el log para revisarlo a mano.
    console.warn(`Wompi: aviso no aplicado (${result})`, { product: ADS_FREE_PRODUCT, transactionId: payment.transactionId });
  }
  return res.status(200).json({ ok: true, result });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (typeof req.query.webhook === 'string') return await webhook(req, res);
    return await checkout(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: err instanceof Error ? err.message : 'Error desconocido' });
    }
  }
}
