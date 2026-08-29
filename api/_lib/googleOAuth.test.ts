import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authorizeUrl, makePkce, parseIdToken } from './googleOAuth.js';

describe('makePkce', () => {
  it('challenge = base64url(sha256(verifier))', () => {
    const { verifier, challenge } = makePkce();
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
    expect(verifier).not.toContain('='); // base64url, sin padding
  });
});

describe('authorizeUrl', () => {
  it('arma la URL de Google con los params del flujo code + PKCE', () => {
    const url = new URL(
      authorizeUrl(
        { clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://app/api/auth/google/callback' },
        'st4te',
        'ch4llenge'
      )
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app/api/auth/google/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe('st4te');
    expect(url.searchParams.get('code_challenge')).toBe('ch4llenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

describe('parseIdToken', () => {
  function jwt(payload: Record<string, unknown>): string {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`;
  }

  it('extrae sub/email/name/picture y normaliza email_verified', () => {
    const id = parseIdToken(
      jwt({ sub: '123', email: 'a@b.com', email_verified: true, name: 'Ana', picture: 'http://p' })
    );
    expect(id).toEqual({ sub: '123', email: 'a@b.com', emailVerified: true, name: 'Ana', picture: 'http://p' });
  });

  it('email_verified string "true" también cuenta', () => {
    expect(parseIdToken(jwt({ sub: '1', email: 'x@y.com', email_verified: 'true' })).emailVerified).toBe(true);
  });

  it('sin email_verified → false', () => {
    expect(parseIdToken(jwt({ sub: '1', email: 'x@y.com' })).emailVerified).toBe(false);
  });

  it('rompe si falta sub o email', () => {
    expect(() => parseIdToken(jwt({ email: 'x@y.com' }))).toThrow();
    expect(() => parseIdToken('no-es-un-jwt')).toThrow();
  });
});
