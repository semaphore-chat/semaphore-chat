// @vitest-environment node
/**
 * Sign in with browser, main-process half (#442): the one-shot loopback
 * listener the instance's /desktop-login page hands the code back to.
 */
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildBrowserLoginUrl,
  startBrowserLogin,
  type BrowserLoginAttempt,
} from '../../../electron/browser-login';

const CHALLENGE = 'c'.repeat(43);
const CODE = 'k'.repeat(43);

/** GET a URL on the listener, with an optional Host override. */
function get(url: string, host?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: host ? { Host: host } : {} }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
  });
}

function paramsOf(attempt: BrowserLoginAttempt) {
  const query = new URLSearchParams(attempt.url.split('#/desktop-login?')[1]);
  return { state: query.get('state')!, port: Number(query.get('port')) };
}

let attempt: BrowserLoginAttempt | undefined;
afterEach(() => attempt?.cancel());

describe('buildBrowserLoginUrl', () => {
  const params = { codeChallenge: CHALLENGE, state: 's'.repeat(43), port: 51234 };

  it('points at the instance\'s desktop sign-in route, in the fragment', () => {
    expect(buildBrowserLoginUrl('https://chat.example.com', params)).toBe(
      `https://chat.example.com/#/desktop-login?challenge=${CHALLENGE}&state=${'s'.repeat(43)}&port=51234`,
    );
  });

  it('keeps a sub-path instance and drops a trailing slash', () => {
    expect(buildBrowserLoginUrl('https://example.com/chat/', params)).toMatch(
      /^https:\/\/example\.com\/chat\/#\/desktop-login\?/,
    );
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'not a url', 'https://user:pw@example.com'])(
    'refuses %s',
    (url) => {
      expect(buildBrowserLoginUrl(url, params)).toBeNull();
    },
  );
});

describe('startBrowserLogin', () => {
  it('refuses a malformed challenge', async () => {
    await expect(
      startBrowserLogin({ instanceUrl: 'https://chat.example.com', codeChallenge: 'short' }),
    ).rejects.toThrow('Invalid code challenge');
  });

  it('hands back the code from a callback with the right state, once', async () => {
    attempt = await startBrowserLogin({ instanceUrl: 'https://chat.example.com', codeChallenge: CHALLENGE });
    const { state, port } = paramsOf(attempt);
    expect(attempt.url).toContain(`challenge=${CHALLENGE}`);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const res = await get(`http://127.0.0.1:${port}/callback?code=${CODE}&state=${state}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('signed in');
    await expect(attempt.result).resolves.toEqual({ status: 'code', code: CODE });

    // The listener is gone afterwards
    await expect(get(`http://127.0.0.1:${port}/callback?code=${CODE}&state=${state}`)).rejects.toThrow();
  });

  it('ignores callbacks with the wrong state, path, host or code, and keeps waiting', async () => {
    attempt = await startBrowserLogin({ instanceUrl: 'https://chat.example.com', codeChallenge: CHALLENGE });
    const { state, port } = paramsOf(attempt);
    const base = `http://127.0.0.1:${port}`;

    expect((await get(`${base}/callback?code=${CODE}&state=${'x'.repeat(43)}`)).status).toBe(400);
    expect((await get(`${base}/callback?code=${CODE}`)).status).toBe(400);
    expect((await get(`${base}/other?code=${CODE}&state=${state}`)).status).toBe(400);
    expect((await get(`${base}/callback?code=bad&state=${state}`)).status).toBe(400);
    // DNS rebinding: a page on another name resolving to 127.0.0.1
    expect((await get(`${base}/callback?code=${CODE}&state=${state}`, `evil.example:${port}`)).status).toBe(400);

    const ok = await get(`${base}/callback?code=${CODE}&state=${state}`);
    expect(ok.status).toBe(200);
    await expect(attempt.result).resolves.toEqual({ status: 'code', code: CODE });
  });

  it('reports a cancel on the confirm page as denied', async () => {
    attempt = await startBrowserLogin({ instanceUrl: 'https://chat.example.com', codeChallenge: CHALLENGE });
    const { state, port } = paramsOf(attempt);

    const res = await get(`http://127.0.0.1:${port}/callback?error=access_denied&state=${state}`);
    expect(res.body).toContain('cancelled');
    await expect(attempt.result).resolves.toEqual({ status: 'denied' });
  });

  it('can be cancelled from the app, and times out', async () => {
    attempt = await startBrowserLogin({ instanceUrl: 'https://chat.example.com', codeChallenge: CHALLENGE });
    attempt.cancel();
    await expect(attempt.result).resolves.toEqual({ status: 'cancelled' });

    const slow = await startBrowserLogin({
      instanceUrl: 'https://chat.example.com',
      codeChallenge: CHALLENGE,
      timeoutMs: 20,
    });
    await expect(slow.result).resolves.toEqual({ status: 'timeout' });
  });
});
