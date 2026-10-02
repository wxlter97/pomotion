import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WompiError,
  createPaymentLink,
  parseWebhookBody,
  resetWompiTokenCache,
  verifyWebhookSignature,
  wompiConfig,
} from './wompi.js';

const CFG = { ...wompiConfig({}), clientId: 'app', clientSecret: 'secret' };

afterEach(() => {
  vi.unstubAllGlobals();
  resetWompiTokenCache();
});

describe('verifyWebhookSignature', () => {
  const body = '{"IdTransaccion":"t1"}';
  const sig = crypto.createHmac('sha256', 'secret').update(body).digest('hex');

  it('acepta la firma correcta (sin importar mayúsculas)', () => {
    expect(verifyWebhookSignature(body, sig, 'secret')).toBe(true);
    expect(verifyWebhookSignature(body, sig.toUpperCase(), 'secret')).toBe(true);
  });

  it('rechaza firma ausente, ajena, o cuerpo alterado', () => {
    expect(verifyWebhookSignature(body, undefined, 'secret')).toBe(false);
    expect(verifyWebhookSignature(body, 'abc', 'secret')).toBe(false);
    expect(verifyWebhookSignature(body + ' ', sig, 'secret')).toBe(false);
    expect(verifyWebhookSignature(body, sig, '')).toBe(false);
  });
});

describe('parseWebhookBody', () => {
  const ok = {
    ResultadoTransaccion: 'ExitosaAprobada',
    EsProductiva: true,
    Monto: 1.99,
    IdTransaccion: 'tx-1',
    EnlacePago: { IdentificadorEnlaceComercio: 'ref-1' },
    cliente: { Email: 'ana@gmail.com' },
  };

  it('normaliza un cobro exitoso', () => {
    expect(parseWebhookBody(JSON.stringify(ok), CFG)).toEqual({
      reference: 'ref-1',
      transactionId: 'tx-1',
      amountCents: 199,
      email: 'ana@gmail.com',
    });
  });

  it('ignora cobros no exitosos, JSON roto y pagos de prueba', () => {
    expect(parseWebhookBody(JSON.stringify({ ...ok, ResultadoTransaccion: 'Rechazada' }), CFG)).toBeNull();
    expect(parseWebhookBody('no es json', CFG)).toBeNull();
    expect(parseWebhookBody('[]', CFG)).toBeNull();
    const test = JSON.stringify({ ...ok, EsProductiva: false });
    expect(parseWebhookBody(test, CFG)).toBeNull();
    expect(parseWebhookBody(test, { ...CFG, acceptTestPayments: true })).not.toBeNull();
  });

  it('monto ilegible = null (después no activa)', () => {
    const p = parseWebhookBody(JSON.stringify({ ...ok, Monto: undefined }), CFG);
    expect(p?.amountCents).toBeNull();
  });
});

describe('createPaymentLink', () => {
  const input = {
    reference: 'ref-1',
    amountCents: 199,
    productName: 'Pomotion · sin anuncios',
    redirectUrl: 'https://app/?pago=ok',
    returnUrl: 'https://app/?pago=cancelado',
    webhookUrl: 'https://app/api/billing?webhook=1',
  };

  it('pide token, crea un EnlacePago de monto fijo y devuelve la URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ urlEnlace: 'https://pay/x', idEnlace: 42 })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createPaymentLink(input, CFG)).resolves.toEqual({ url: 'https://pay/x', linkId: '42' });

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.wompi.sv/EnlacePago');
    expect(init.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toMatchObject({
      identificadorEnlaceComercio: 'ref-1',
      monto: 1.99,
      configuracion: { esMontoEditable: false, esCantidadEditable: false, urlWebhook: input.webhookUrl },
    });
  });

  it('reutiliza el token entre llamadas', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })))
      .mockResolvedValue(new Response(JSON.stringify({ urlEnlace: 'https://pay/x' })));
    vi.stubGlobal('fetch', fetchMock);
    await createPaymentLink(input, CFG);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ urlEnlace: 'https://pay/y' })));
    await createPaymentLink(input, CFG);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 token + 2 enlaces
  });

  it('falla con WompiError si rechazan credenciales o no hay URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('nope', { status: 401 })));
    await expect(createPaymentLink(input, CFG)).rejects.toBeInstanceOf(WompiError);

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok' })))
        .mockResolvedValueOnce(new Response(JSON.stringify({})))
    );
    await expect(createPaymentLink(input, CFG)).rejects.toThrow(/URL/);
  });

  it('sin credenciales configuradas no sale a la red', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(createPaymentLink(input, { ...CFG, clientId: '', clientSecret: '' })).rejects.toThrow(/WOMPI_CLIENT_ID/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
