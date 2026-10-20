import { expect, it } from 'vitest';
import { parseOAuthCallback } from './oauth';
it('rejects malformed, multibyte, duplicate and wrong-issuer callback state without throwing', () => {
  const state = 'a'.repeat(43), issuer = 'https://example.com';
  for (const url of ['http://[invalid', `/callback?state=${'é'.repeat(43)}&iss=${issuer}&code=code`, `/callback?state=${state}&state=${state}&iss=${issuer}&code=code`, `/callback?state=${state}&iss=https://other.example&code=code`, '/callback?state=wrong']) {
    expect(() => parseOAuthCallback(url, 'GET', state, issuer)).not.toThrow(); expect(parseOAuthCallback(url, 'GET', state, issuer)).toBeNull();
  }
  expect(parseOAuthCallback(`/callback?state=${state}&iss=${issuer}&code=synthetic`, 'GET', state, issuer)).toEqual({ code: 'synthetic' });
  expect(parseOAuthCallback(`/callback?state=${state}&iss=${issuer}&error=denied`, 'GET', state, issuer)).toEqual({ error: true });
});
