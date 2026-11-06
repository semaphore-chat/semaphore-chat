import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect, type Page } from '@playwright/test';
import { TEST_USER } from './fixtures';

/**
 * Page script against the refresh token, in real browsers: Chromium in the
 * `chromium` project, Firefox in `auth-token-delivery-firefox`. Backend e2e
 * only simulates a browser's headers; this is what browsers really send and
 * get. See docs-site/docs/architecture/auth-clients.md.
 *
 * The security result is the assertions on POST /auth/refresh. The rest pins
 * what the defense-in-depth check in backend/src/auth/client-type.util.ts can
 * and can't rely on: that check is not a security boundary.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const FORGED_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 Forged Electron/39.0.0',
  'X-Client-Type': 'desktop-native',
  'X-Device-Id': '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
};

/** The variants of a same-origin POST that page script can choose from. */
const VARIANTS: Record<string, RequestInit> = {
  default: {},
  "mode 'same-origin' with referrerPolicy 'no-referrer'": {
    mode: 'same-origin',
    referrerPolicy: 'no-referrer',
  },
};

/** A same-origin page without the app, so that only the test's script runs. */
async function openBlankPage(page: Page) {
  await page.route('**/token-delivery-probe', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>probe</title>',
    }),
  );
  await page.goto('/token-delivery-probe');
}

function pagePost(
  page: Page,
  path: string,
  body: unknown,
  headers: Record<string, string>,
  init: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(
    async ({ path, body, headers, init }) => {
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(body),
        ...init,
      });
      return { status: res.status, body: await res.json() };
    },
    { path, body, headers, init },
  );
}

const signIn = (page: Page) =>
  pagePost(
    page,
    '/api/auth/login',
    { username: TEST_USER.username, password: TEST_USER.password },
    { 'Content-Type': 'application/json' },
    {},
  );

for (const [variant, init] of Object.entries(VARIANTS)) {
  test.describe(`page script, ${variant}`, () => {
    test('POST /auth/refresh with the cookie never returns a refresh token @smoke', async ({ page }) => {
      await openBlankPage(page);
      const session = await signIn(page);
      expect(session.status).toBe(200);
      expect(session.body).not.toHaveProperty('refreshToken');

      const refreshed = await pagePost(page, '/api/auth/refresh', {}, FORGED_HEADERS, init);

      expect(refreshed.status).toBe(200);
      expect(typeof refreshed.body.accessToken).toBe('string');
      expect(refreshed.body).not.toHaveProperty('refreshToken');
    });

    test('a sign-in declaring a native type returns no refresh token', async ({ page }) => {
      // Not what protects anything (whoever has the password can sign in from
      // anywhere): the defense-in-depth check, on a secure origin
      await openBlankPage(page);

      const res = await pagePost(
        page,
        '/api/auth/login',
        { username: TEST_USER.username, password: TEST_USER.password },
        FORGED_HEADERS,
        init,
      );

      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('refreshToken');
    });
  });
}

test('page script cannot read the refresh cookie', async ({ page, context }) => {
  await openBlankPage(page);
  await signIn(page);

  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === 'refresh_token')?.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('refresh_token');
});

/**
 * What reaches a server, on the wire, from each variant: an echo server, since
 * the app's dev proxy stands between the browser and the backend otherwise.
 * If a browser update changes these, reconsider isBrowserPageRequest.
 */
test.describe('headers page script can send', () => {
  let server: http.Server;
  let origin: string;
  const seen = new Map<string, http.IncomingHttpHeaders>();

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.method === 'POST') {
        seen.set(req.url ?? '', req.headers);
        res.setHeader('Content-Type', 'application/json');
        res.end('{}');
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>probe</title>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  test('Origin, User-Agent and fetch metadata, per browser @smoke', async ({ page, browserName }) => {
    await page.goto(origin);
    const isFirefox = browserName === 'firefox';

    const probe = async (path: string, init: RequestInit) => {
      await pagePost(page, path, {}, FORGED_HEADERS, init);
      return seen.get(path)!;
    };

    const plain = await probe('/default', VARIANTS.default);
    const noReferrer = await probe(
      '/no-referrer',
      VARIANTS["mode 'same-origin' with referrerPolicy 'no-referrer'"],
    );
    console.warn(
      `[probe] ${browserName}`,
      JSON.stringify({
        default: { origin: plain.origin, ua: plain['user-agent'] },
        noReferrer: {
          origin: noReferrer.origin,
          ua: noReferrer['user-agent'],
          site: noReferrer['sec-fetch-site'],
        },
      }),
    );

    // Any browser: a page can declare any client type
    expect(plain['x-client-type']).toBe('desktop-native');
    expect(noReferrer['x-client-type']).toBe('desktop-native');
    // Fetch metadata can't be set by script, and says same-origin either way
    expect(plain['sec-fetch-site']).toBe('same-origin');
    expect(noReferrer['sec-fetch-site']).toBe('same-origin');
    // A default fetch has the page's real origin
    expect(plain.origin).toBe(origin);

    // Firefox lets script forge the user agent, and send `Origin: null`
    expect(plain['user-agent']?.includes('Forged Electron')).toBe(isFirefox);
    expect(noReferrer.origin).toBe(isFirefox ? 'null' : origin);
  });
});
