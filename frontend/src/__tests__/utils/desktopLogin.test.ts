import { describe, expect, it } from 'vitest';
import {
  desktopCallbackUrl,
  desktopCancelUrl,
  parseDesktopLoginParams,
  safeLoginReturnTo,
} from '../../utils/desktopLogin';
import { createPkcePair, pkceChallenge } from '../../utils/pkce';

const challenge = 'c'.repeat(43);
const state = 's'.repeat(43);

describe('parseDesktopLoginParams', () => {
  const parse = (query: string) => parseDesktopLoginParams(new URLSearchParams(query));

  it('reads a well-formed link', () => {
    expect(parse(`challenge=${challenge}&state=${state}&port=51234`)).toEqual({
      challenge,
      state,
      port: 51234,
    });
  });

  it.each([
    ['missing challenge', `state=${state}&port=51234`],
    ['short challenge', `challenge=abc&state=${state}&port=51234`],
    ['bad state', `challenge=${challenge}&state=<script>&port=51234`],
    ['privileged port', `challenge=${challenge}&state=${state}&port=80`],
    ['port out of range', `challenge=${challenge}&state=${state}&port=70000`],
    ['port with a host', `challenge=${challenge}&state=${state}&port=51234@evil.example`],
  ])('refuses a link with a %s', (_name, query) => {
    expect(parse(query)).toBeNull();
  });
});

describe('callback URLs', () => {
  const params = { challenge, state, port: 51234 };

  it('only ever point at the loopback listener', () => {
    expect(desktopCallbackUrl(params, 'k'.repeat(43))).toBe(
      `http://127.0.0.1:51234/callback?code=${'k'.repeat(43)}&state=${state}`,
    );
    expect(desktopCancelUrl(params)).toBe(
      `http://127.0.0.1:51234/callback?error=access_denied&state=${state}`,
    );
  });
});

describe('safeLoginReturnTo', () => {
  it('allows the desktop sign-in page only', () => {
    expect(safeLoginReturnTo('/desktop-login?challenge=x')).toBe('/desktop-login?challenge=x');
    expect(safeLoginReturnTo('/desktop-login')).toBe('/desktop-login');
    expect(safeLoginReturnTo('/admin')).toBeUndefined();
    expect(safeLoginReturnTo('//evil.example/desktop-login')).toBeUndefined();
    expect(safeLoginReturnTo('/desktop-login-evil')).toBeUndefined();
    expect(safeLoginReturnTo(undefined)).toBeUndefined();
  });
});

describe('pkce', () => {
  it('matches the RFC 7636 appendix B example', async () => {
    await expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('makes a fresh 43-character verifier with its challenge', async () => {
    const a = await createPkcePair();
    const b = await createPkcePair();
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.challenge).toBe(await pkceChallenge(a.verifier));
    expect(a.verifier).not.toBe(b.verifier);
  });
});
