// @vitest-environment node
/**
 * Sign in with browser, main-process half (#442): the one-shot loopback
 * listener the instance's /desktop-login page hands the code back to.
 */
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BrowserLoginSessions,
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

describe('BrowserLoginSessions', () => {
  const options = { instanceUrl: 'https://chat.example.com', codeChallenge: CHALLENGE };

  /** A start whose listeners bind when the test says so, in call order. */
  function slowStart() {
    const attempts: BrowserLoginAttempt[] = [];
    const binders: (() => Promise<void>)[] = [];
    const start = (opts: typeof options) =>
      new Promise<BrowserLoginAttempt>((resolve) => {
        binders.push(async () => {
          const attempt = await startBrowserLogin(opts);
          attempts.push(attempt);
          resolve(attempt);
        });
      });
    const bind = async () => {
      for (const binder of binders.splice(0)) await binder();
    };
    return { start, attempts, bind };
  }

  it('closes an attempt cancelled while its listener was binding', async () => {
    const slow = slowStart();
    const sessions = new BrowserLoginSessions(slow.start);

    const begun = sessions.begin(options);
    sessions.cancel();
    await slow.bind();

    await expect(begun).resolves.toBeNull();
    await expect(slow.attempts[0].result).resolves.toEqual({ status: 'cancelled' });
    const { port } = paramsOf(slow.attempts[0]);
    await expect(get(`http://127.0.0.1:${port}/callback`)).rejects.toThrow();
  });

  it('a newer start replaces one still binding; cancel ends the running one', async () => {
    const slow = slowStart();
    const sessions = new BrowserLoginSessions(slow.start);

    const first = sessions.begin(options);
    const second = sessions.begin(options);
    await slow.bind();

    await expect(first).resolves.toBeNull();
    await expect(slow.attempts[0].result).resolves.toEqual({ status: 'cancelled' });
    const running = await second;
    expect(running).toBe(slow.attempts[1]);

    // A start after it has bound cancels it too
    const next = sessions.begin(options);
    await expect(running!.result).resolves.toEqual({ status: 'cancelled' });
    await slow.bind();
    const latest = await next;
    sessions.cancel();
    await expect(latest!.result).resolves.toEqual({ status: 'cancelled' });
  });
});
