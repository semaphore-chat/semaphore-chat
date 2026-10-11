/**
 * Sign in with browser: the main-process half (#442, #66).
 *
 * The desktop app opens the user's browser at the instance's
 * `/#/desktop-login` page, where they sign in the usual way (password
 * manager, existing session) and confirm. The page then sends the browser to
 * a one-shot HTTP listener here on the loopback interface
 * (`http://127.0.0.1:<port>/callback?code=…&state=…`, RFC 8252 section 7.3),
 * which hands the code to the renderer. The renderer redeems it with its
 * PKCE verifier (which never leaves the renderer) at POST /auth/desktop/token.
 *
 * Loopback rather than the `semaphore://` scheme: it needs no OS protocol
 * registration (AppImages that were never integrated, dev builds), no
 * "Open Semaphore Chat?" browser prompt, and no other app can register it
 * in our place.
 *
 * What the listener trusts: nothing. It answers only GET /callback, on the
 * exact Host it was bound to (DNS rebinding), with the attempt's `state`
 * (a page that guesses the port still can't inject a code), and a code of
 * the right shape. Anything else gets a 400 and the attempt keeps waiting.
 *
 * No `electron` import, so it can be unit tested under plain Node.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** How long the app waits for the browser: long enough to sign in from scratch. */
export const BROWSER_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

const CODE_RE = /^[A-Za-z0-9_-]{43}$/;
/** S256 PKCE challenge: base64url SHA-256, 43 characters. */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export type BrowserLoginResult =
  | { status: 'code'; code: string }
  /** The user pressed Cancel on the browser's confirm page. */
  | { status: 'denied' }
  /** Cancelled in the app (or a newer attempt replaced this one). */
  | { status: 'cancelled' }
  | { status: 'timeout' }
  | { status: 'error'; message: string };

export interface BrowserLoginAttempt {
  /** The page to open in the browser. */
  url: string;
  /** Settles once: a code, or why there isn't one. */
  result: Promise<BrowserLoginResult>;
  cancel(): void;
}

/**
 * The instance's desktop sign-in page for an attempt, or null for an
 * instance URL that isn't plain http(s) (the app only ever stores those).
 */
export function buildBrowserLoginUrl(
  instanceUrl: string,
  params: { codeChallenge: string; state: string; port: number },
): string | null {
  let base: URL;
  try {
    base = new URL(instanceUrl);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  if (base.username || base.password) return null;
  const query = new URLSearchParams({
    challenge: params.codeChallenge,
    state: params.state,
    port: String(params.port),
  });
  const path = base.pathname.replace(/\/+$/, '');
  // The web app uses a HashRouter: the route and its query live in the
  // fragment, which the browser never sends to the server or its logs
  return `${base.origin}${path}/#/desktop-login?${query.toString()}`;
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function page(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:Canvas;color:CanvasText}
main{max-width:28rem;padding:2rem 1.5rem;text-align:center}
h1{font-size:1.4rem;margin:0 0 .75rem}
p{margin:0;opacity:.8;line-height:1.5}
</style></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

const SUCCESS_PAGE = page(
  'You’re signed in',
  'Semaphore Chat is signing you in. You can close this tab and go back to the app.',
);
const DENIED_PAGE = page(
  'Sign-in cancelled',
  'The desktop app wasn’t signed in. You can close this tab.',
);
const BAD_REQUEST_PAGE = page(
  'This link doesn’t work',
  'Start again with “Sign in with browser” in the Semaphore Chat app.',
);

/**
 * Start listening for one browser sign-in. Resolves once the listener is
 * bound (the URL needs its port); the attempt's `result` settles later.
 */
export async function startBrowserLogin(options: {
  instanceUrl: string;
  codeChallenge: string;
  timeoutMs?: number;
}): Promise<BrowserLoginAttempt> {
  if (!CHALLENGE_RE.test(options.codeChallenge)) {
    throw new Error('Invalid code challenge');
  }
  const state = randomBytes(32).toString('base64url');

  let settle!: (result: BrowserLoginResult) => void;
  const result = new Promise<BrowserLoginResult>((resolve) => {
    settle = resolve;
  });
  let settled = false;
  const timeout: { handle?: NodeJS.Timeout } = {};

  const server = http.createServer((req, res) => {
    const send = (status: number, body: string) => {
      res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
        // One request per connection: nothing outlives the attempt
        Connection: 'close',
      });
      res.end(body);
    };

    const port = (server.address() as AddressInfo | null)?.port;
    if (settled || req.method !== 'GET' || req.headers.host !== `127.0.0.1:${port}`) {
      send(400, BAD_REQUEST_PAGE);
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    } catch {
      send(400, BAD_REQUEST_PAGE);
      return;
    }
    const givenState = url.searchParams.get('state') ?? '';
    if (url.pathname !== '/callback' || !sameSecret(givenState, state)) {
      send(400, BAD_REQUEST_PAGE);
      return;
    }
    if (url.searchParams.get('error') === 'access_denied') {
      send(200, DENIED_PAGE);
      finish({ status: 'denied' });
      return;
    }
    const code = url.searchParams.get('code') ?? '';
    if (!CODE_RE.test(code)) {
      send(400, BAD_REQUEST_PAGE);
      return;
    }
    send(200, SUCCESS_PAGE);
    finish({ status: 'code', code });
  });

  function finish(outcome: BrowserLoginResult) {
    if (settled) return;
    settled = true;
    if (timeout.handle) clearTimeout(timeout.handle);
    // Let the response that settled it go out first
    server.close();
    server.closeIdleConnections?.();
    settle(outcome);
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // 127.0.0.1, not localhost: the browser must reach exactly this socket,
    // and some resolve localhost to ::1 first
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  server.on('error', (error) => finish({ status: 'error', message: String(error) }));

  const { port } = server.address() as AddressInfo;
  const url = buildBrowserLoginUrl(options.instanceUrl, {
    codeChallenge: options.codeChallenge,
    state,
    port,
  });
  if (!url) {
    server.close();
    throw new Error('Invalid instance URL');
  }

  timeout.handle = setTimeout(
    () => finish({ status: 'timeout' }),
    options.timeoutMs ?? BROWSER_LOGIN_TIMEOUT_MS,
  );
  timeout.handle.unref?.();

  return { url, result, cancel: () => finish({ status: 'cancelled' }) };
}

/**
 * The app's browser sign-in, one at a time: starting one cancels the last,
 * and a cancel (or a newer start) that lands while an attempt is still
 * binding its listener closes that listener as soon as it is bound, instead
 * of leaving it up until its timeout.
 */
export class BrowserLoginSessions {
  private active: BrowserLoginAttempt | null = null;
  /** Bumped by every cancel, and so by every begin. */
  private generation = 0;

  constructor(private readonly start: typeof startBrowserLogin = startBrowserLogin) {}

  /**
   * Start an attempt. Resolves null if it was cancelled or replaced while
   * starting (its listener is closed already); throws what `start` throws.
   */
  async begin(options: Parameters<typeof startBrowserLogin>[0]): Promise<BrowserLoginAttempt | null> {
    this.cancel();
    const generation = this.generation;
    const attempt = await this.start(options);
    if (generation !== this.generation) {
      attempt.cancel();
      return null;
    }
    this.active = attempt;
    return attempt;
  }

  /** Cancel the attempt in progress, including one still starting. */
  cancel(): void {
    this.generation++;
    this.active?.cancel();
    this.active = null;
  }

  /** Forget an attempt that has settled. */
  finished(attempt: BrowserLoginAttempt): void {
    if (this.active === attempt) this.active = null;
  }
}
