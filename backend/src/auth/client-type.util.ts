/**
 * The client-type contract: how a client asks for its refresh token, and what
 * decides whether it gets it. docs-site/docs/architecture/auth-clients.md is
 * the description for client authors.
 *
 * What protects refresh tokens from page script is not in this file's header
 * checks: POST /auth/refresh never answers a cookie-presented token with a
 * body token (presentedRefreshToken), and the sign-in endpoints need a
 * password or a PKCE code, which work from any machine anyway.
 *
 * isBrowserPageRequest is defense in depth, not a security boundary.
 * X-Client-Type is a request and not proof of anything: page script can set
 * it, and Firefox lets it send a forged User-Agent and, with mode
 * 'same-origin' and referrerPolicy 'no-referrer', `Origin: null`
 * (frontend/e2e/auth-token-delivery.spec.ts pins that). `Sec-Fetch-Site`
 * catches that variant only where browsers send it, which leaves out
 * plain-HTTP, non-localhost instances.
 */
import { DEVICE_ID_HEADER, parseDeviceId } from './device-id.util';

export const CLIENT_TYPE_HEADER = 'x-client-type';
export const DEVICE_NAME_HEADER = 'x-device-name';

export const CLIENT_TYPES = [
  'web',
  'electron',
  'desktop-native',
  'mobile-native',
] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const DEVICE_NAME_MAX_LENGTH = 64;
/** Longer than a percent-encoded name of the maximum length can usefully be. */
const DEVICE_NAME_HEADER_MAX_LENGTH = 1024;

/** The packaged app is a file:// page; in development, Vite's dev server. */
const DEV_ELECTRON_ORIGIN = 'http://localhost:5173';

export type RequestHeaders = Record<string, string | string[] | undefined>;

/** What a sign-in answers with, and the session's type. */
export interface SignInClient {
  clientType: ClientType;
  tokenDelivery: 'cookie' | 'body';
}

/** Where a refresh request's token came from. */
export interface PresentedRefreshToken {
  via: 'body' | 'cookie' | 'none';
  /** Missing for `none`, and for a malformed body token. */
  token?: string;
}

/** The type a request declares, if it is one we know. */
export function parseClientType(value: unknown): ClientType | undefined {
  return CLIENT_TYPES.find((type) => type === value);
}

export function isNativeClientType(type: ClientType | null | undefined) {
  return type === 'desktop-native' || type === 'mobile-native';
}

function header(headers: RequestHeaders, name: string): string | undefined {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

function isElectronUserAgent(headers: RequestHeaders): boolean {
  return (header(headers, 'user-agent') ?? '').includes('Electron');
}

/**
 * The Electron app under `pnpm run dev`: a real browser origin, so it needs
 * an exception, in development only.
 */
function isDevElectronPage(headers: RequestHeaders): boolean {
  return (
    process.env.NODE_ENV === 'development' &&
    header(headers, 'origin') === DEV_ELECTRON_ORIGIN &&
    isElectronUserAgent(headers)
  );
}

/**
 * Whether a request visibly comes from a web page. Defense in depth, not a
 * security boundary: see the top of this file for what gets past it.
 */
export function isBrowserPageRequest(headers: RequestHeaders): boolean {
  if (isDevElectronPage(headers)) return false;
  if (/^https?:/i.test(header(headers, 'origin') ?? '')) return true;
  const site = header(headers, 'sec-fetch-site');
  return site === 'same-origin' || site === 'same-site';
}

/** Native clients are not browsers at all: no Origin, no fetch metadata. */
function hasBrowserRequestHeaders(headers: RequestHeaders): boolean {
  return (
    headers.origin !== undefined ||
    Object.keys(headers).some((name) => name.startsWith('sec-fetch-'))
  );
}

/**
 * How a sign-in (POST /auth/login, POST /auth/desktop/token) answers: body
 * delivery for a non-web client that doesn't look like a web page, cookies
 * otherwise. Electron builds from before the header are recognised by their
 * user agent, for as long as they're in the field.
 */
export function resolveSignInClient(headers: RequestHeaders): SignInClient {
  const web: SignInClient = { clientType: 'web', tokenDelivery: 'cookie' };
  const requested =
    parseClientType(header(headers, CLIENT_TYPE_HEADER)) ??
    (isElectronUserAgent(headers) ? 'electron' : 'web');

  if (requested === 'web') return web;
  const looksLikeBrowser = isNativeClientType(requested)
    ? hasBrowserRequestHeaders(headers)
    : isBrowserPageRequest(headers);
  return looksLikeBrowser
    ? web
    : { clientType: requested, tokenDelivery: 'body' };
}

/**
 * Whether a client that gets body delivery can be told apart from a thief
 * during a refresh's grace window: it needs a device id and a user agent. A
 * native client without them gets an error instead of a session that would
 * be weaker than others (an empty user agent matches an empty one).
 */
export function hasNativeClientIdentity(headers: RequestHeaders): boolean {
  return (
    parseDeviceId(headers[DEVICE_ID_HEADER]) !== undefined &&
    !!header(headers, 'user-agent')
  );
}

/**
 * The client type of a refresh: a cookie is a web session, a body token a
 * client that holds its own. Metadata, for a session from before the column;
 * nothing decides anything from it.
 */
export function refreshingClientType(
  via: PresentedRefreshToken['via'],
  headers: RequestHeaders,
): ClientType | undefined {
  if (via !== 'body') return 'web';
  const declared = parseClientType(header(headers, CLIENT_TYPE_HEADER));
  if (declared && declared !== 'web') return declared;
  return isElectronUserAgent(headers) ? 'electron' : undefined;
}

/**
 * The refresh token a request presents. A token in the body is the one used,
 * even with a cookie alongside: a client that holds its own token means that
 * token. A malformed one is refused, not replaced by the cookie, so whatever
 * sends a body never acts on the cookie's session instead.
 */
export function presentedRefreshToken(req: {
  cookies?: unknown;
  body?: unknown;
}): PresentedRefreshToken {
  const body = req.body as { refreshToken?: unknown } | undefined;
  const fromBody = body?.refreshToken;
  if (fromBody !== undefined && fromBody !== null) {
    return typeof fromBody === 'string' && fromBody !== ''
      ? { via: 'body', token: fromBody }
      : { via: 'body' };
  }
  const cookie = (req.cookies as Record<string, unknown> | undefined)
    ?.refresh_token;
  return typeof cookie === 'string' && cookie !== ''
    ? { via: 'cookie', token: cookie }
    : { via: 'none' };
}

/**
 * A client's name for its device, as shown in its owner's sessions list:
 * percent-encoded UTF-8 (headers are not UTF-8), capped, with control, format
 * (bidi overrides, zero-width) and separator characters and angle brackets
 * taken out. It is still user-supplied: don't log it or render it unescaped.
 * Anything unusable means no name, which only falls back to a generic one.
 */
export function parseDeviceName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length > DEVICE_NAME_HEADER_MAX_LENGTH) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  const cleaned = decoded
    .normalize('NFC')
    .replace(/[\p{C}\p{Zl}\p{Zp}<>]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const name = Array.from(cleaned)
    .slice(0, DEVICE_NAME_MAX_LENGTH)
    .join('')
    .trim();
  return name === '' ? undefined : name;
}
