/**
 * The server half of signing out: the logout call (with a timeout, so local
 * sign-out never waits on a stalled server), and on the web the retry of a
 * logout that never reached the server.
 *
 * Why the retry: on the web the refresh token is an httpOnly cookie that only
 * the server's logout response can delete. When that call fails, signOutSession
 * marks a server sign-out as owed (tokenService SERVER_SIGN_OUT_OWED_KEY);
 * while the flag is set no refresh is sent, so the cookie cannot silently sign
 * the previous user back in, and settleOwedServerSignOut() retries the logout
 * on the next load until the server confirms it.
 */
import axios from "axios";
import { authControllerLogout } from "../api-client/sdk.gen";
import { getApiUrl } from "../config/env";
import { deviceIdHeaders } from "./deviceId";
import { clearServerSignOutOwed, isServerSignOutOwed } from "./tokenService";
import { logger } from "./logger";

/** How long the logout call may take before sign-out goes on without it. */
export const LOGOUT_REQUEST_TIMEOUT_MS = 5000;

type LogoutOutcome = "confirmed" | "unauthorized" | "failed";

/**
 * Call the logout endpoint, giving up (and aborting the request) after
 * LOGOUT_REQUEST_TIMEOUT_MS. Never throws.
 * @param refreshToken - Electron's refresh token (the web sends the cookie)
 * @param accessToken - Authenticates the call when no access token is in memory
 */
async function callLogout(
  refreshToken?: string,
  accessToken?: string,
): Promise<LogoutOutcome> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"failed">((resolve) => {
    timer = setTimeout(() => {
      abort.abort();
      resolve("failed");
    }, LOGOUT_REQUEST_TIMEOUT_MS);
  });
  const call = authControllerLogout({
    body: { refreshToken },
    signal: abort.signal,
    ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
  }).then(
    ({ response }): LogoutOutcome => {
      if (response?.ok) return "confirmed";
      return response?.status === 401 ? "unauthorized" : "failed";
    },
    (): LogoutOutcome => "failed",
  );
  try {
    // Raced as well as aborted: the timeout wins even if a fetch ignores the abort
    return await Promise.race([call, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The logout call of a user-initiated sign-out.
 * @returns Whether the server confirmed the sign-out
 */
export async function requestServerLogout(refreshToken?: string): Promise<boolean> {
  return (await callLogout(refreshToken)) === "confirmed";
}

/**
 * A fresh access token for the owed logout, from the refresh cookie. Kept out
 * of the app's token store: it only authenticates the logout below.
 * @returns The token, "none" when the server has no session for the cookie,
 *   or "failed" when it could not answer
 */
async function accessTokenForLogout(): Promise<string | "none" | "failed"> {
  try {
    const { data } = await axios.post<{ accessToken?: string }>(
      getApiUrl("/auth/refresh"),
      {},
      { withCredentials: true, timeout: LOGOUT_REQUEST_TIMEOUT_MS, headers: deviceIdHeaders() },
    );
    return data?.accessToken ?? "failed";
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    return status === 401 || status === 403 ? "none" : "failed";
  }
}

async function settle(): Promise<boolean> {
  let outcome = await callLogout();
  if (outcome === "unauthorized" && isServerSignOutOwed()) {
    // The logout endpoint needs an access token, and the access-token cookie
    // has expired: get one with the refresh cookie (no session -> done)
    const token = await accessTokenForLogout();
    if (token === "none") outcome = "confirmed";
    else if (token !== "failed" && isServerSignOutOwed()) outcome = await callLogout(undefined, token);
  }
  if (outcome === "confirmed") {
    clearServerSignOutOwed();
    return true;
  }
  logger.warn("[SignOut] The server sign-out is still owed; will try again on the next load");
  return false;
}

let settling: Promise<boolean> | null = null;

/**
 * Retry a server sign-out that is still owed (no-op otherwise). Concurrent
 * calls share one attempt. Clears the flag once the server confirms the
 * logout or has no session for the cookie.
 * @returns Whether nothing is owed any more
 */
export function settleOwedServerSignOut(): Promise<boolean> {
  if (!isServerSignOutOwed()) return Promise.resolve(true);
  if (!settling) {
    settling = settle().finally(() => {
      settling = null;
    });
  }
  return settling;
}

/**
 * Resolves once a running settleOwedServerSignOut() has finished. A sign-in
 * waits for it: the owed logout's response deletes the refresh cookie, and
 * must not delete the new session's.
 */
export function whenServerSignOutSettled(): Promise<void> {
  return settling ? settling.then(() => undefined) : Promise.resolve();
}
