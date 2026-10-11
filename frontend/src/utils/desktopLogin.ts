/**
 * The web side of "Sign in with browser" for the desktop app (#442): the
 * parameters the app opens `/#/desktop-login` with, and where the page sends
 * the browser afterwards. The app listens on the loopback interface
 * (frontend/electron/browser-login.ts); the page only ever redirects to
 * `http://127.0.0.1:<port>/callback`, never to a URL taken from the link, so
 * the page can't be turned into an open redirect.
 */

export const DESKTOP_LOGIN_PATH = "/desktop-login";

export interface DesktopLoginParams {
  /** S256 PKCE challenge from the app. */
  challenge: string;
  /** The app's state for this attempt, echoed back so it can match it. */
  state: string;
  /** The app's loopback port. */
  port: number;
}

const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** The link's parameters, or null when any is missing or malformed. */
export function parseDesktopLoginParams(search: URLSearchParams): DesktopLoginParams | null {
  const challenge = search.get("challenge") ?? "";
  const state = search.get("state") ?? "";
  const portText = search.get("port") ?? "";
  if (!CHALLENGE_RE.test(challenge) || !STATE_RE.test(state)) return null;
  if (!/^\d{1,5}$/.test(portText)) return null;
  const port = Number(portText);
  if (port < 1024 || port > 65535) return null;
  return { challenge, state, port };
}

function loopbackCallback(port: number, query: Record<string, string>): string {
  return `http://127.0.0.1:${port}/callback?${new URLSearchParams(query).toString()}`;
}

/** Hand the approved code to the app. */
export function desktopCallbackUrl(params: DesktopLoginParams, code: string): string {
  return loopbackCallback(params.port, { code, state: params.state });
}

/** Tell the app the user cancelled, so it stops waiting. */
export function desktopCancelUrl(params: DesktopLoginParams): string {
  return loopbackCallback(params.port, { error: "access_denied", state: params.state });
}

/**
 * Where the login page may send the user back to after signing in: only the
 * desktop sign-in page (with its query). Anything else is dropped.
 */
export function safeLoginReturnTo(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value !== DESKTOP_LOGIN_PATH && !value.startsWith(`${DESKTOP_LOGIN_PATH}?`)) return undefined;
  return value;
}
