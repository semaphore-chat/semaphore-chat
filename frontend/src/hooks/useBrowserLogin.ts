import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { instanceControllerGetPublicSettingsOptions } from "../api-client/@tanstack/react-query.gen";
import { authControllerRedeemDesktopLogin } from "../api-client/sdk.gen";
import { useElectronAPI } from "../contexts/ElectronContext";
import { getActiveServer } from "../utils/serverStorage";
import { createPkcePair } from "../utils/pkce";
import { setAccessToken, storeElectronRefreshToken } from "../utils/tokenService";
import { logger } from "../utils/logger";

/**
 * Where a "Sign in with browser" attempt is:
 * - idle: not started (or finished with an error, see `error`);
 * - waiting: the browser is open, the app waits for its code;
 * - signing-in: the code arrived, the app redeems it for its session.
 */
export type BrowserLoginPhase = "idle" | "waiting" | "signing-in";

/** Why the last attempt didn't sign in. */
export type BrowserLoginError = "denied" | "timeout" | "failed";

export interface UseBrowserLoginResult {
  /** The desktop app and the server both support it. */
  available: boolean;
  phase: BrowserLoginPhase;
  error: BrowserLoginError | null;
  start: () => Promise<void>;
  cancel: () => void;
}

/**
 * "Sign in with browser" in the desktop app (#442): opens the server's
 * sign-in page in the system browser (where the password manager is), waits
 * for the code it hands back, and redeems it with this app's PKCE verifier.
 * @param onSignedIn - Called once the session is stored
 */
export function useBrowserLogin(onSignedIn: () => void): UseBrowserLoginResult {
  const electronAPI = useElectronAPI();
  const { data: publicSettings } = useQuery({
    ...instanceControllerGetPublicSettingsOptions(),
    enabled: !!electronAPI?.startBrowserLogin,
  });
  const [phase, setPhase] = useState<BrowserLoginPhase>("idle");
  const [error, setError] = useState<BrowserLoginError | null>(null);
  // The attempt that may still act: a cancelled or replaced one is ignored
  const attemptRef = useRef(0);
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;

  const available =
    !!electronAPI?.startBrowserLogin && publicSettings?.desktopBrowserLogin === true;

  const start = useCallback(async () => {
    const startBrowserLogin = electronAPI?.startBrowserLogin;
    const server = getActiveServer();
    if (!startBrowserLogin || !server) return;
    const attempt = ++attemptRef.current;
    setError(null);
    setPhase("waiting");
    try {
      const { verifier, challenge } = await createPkcePair();
      const result = await startBrowserLogin({ instanceUrl: server.url, codeChallenge: challenge });
      if (attempt !== attemptRef.current) return;
      if (result.status !== "code") {
        setPhase("idle");
        if (result.status === "cancelled") return;
        if (result.status === "error") logger.error("[BrowserLogin] main process:", result.message);
        setError(result.status === "denied" || result.status === "timeout" ? result.status : "failed");
        return;
      }
      setPhase("signing-in");
      const { data } = await authControllerRedeemDesktopLogin({
        body: { code: result.code, codeVerifier: verifier },
        throwOnError: true,
      });
      if (attempt !== attemptRef.current) return;
      setAccessToken(data.accessToken);
      if (data.refreshToken) await storeElectronRefreshToken(data.refreshToken);
      setPhase("idle");
      onSignedInRef.current();
    } catch (err) {
      logger.error("[BrowserLogin] sign-in failed:", err);
      if (attempt !== attemptRef.current) return;
      setPhase("idle");
      setError("failed");
    }
  }, [electronAPI]);

  const cancel = useCallback(() => {
    attemptRef.current++;
    setPhase("idle");
    setError(null);
    void electronAPI?.cancelBrowserLogin?.();
  }, [electronAPI]);

  // Leaving the login screen abandons a waiting attempt
  useEffect(
    () => () => {
      if (attemptRef.current > 0) void electronAPI?.cancelBrowserLogin?.();
    },
    [electronAPI],
  );

  return { available, phase, error, start, cancel };
}

const START_ON_LOAD_KEY = "semaphore:startBrowserLoginOnLoad";

/**
 * Ask the login screen to start a browser sign-in right after the reload
 * that applies a new server (the connection wizard's "Sign in with browser").
 */
export function requestBrowserLoginOnLoad(): void {
  try {
    sessionStorage.setItem(START_ON_LOAD_KEY, "1");
  } catch {
    // Storage unavailable: the user clicks the login screen's button instead
  }
}

/** Whether a browser sign-in was requested for this load (asks once). */
export function consumeBrowserLoginOnLoad(): boolean {
  try {
    const requested = sessionStorage.getItem(START_ON_LOAD_KEY) === "1";
    sessionStorage.removeItem(START_ON_LOAD_KEY);
    return requested;
  } catch {
    return false;
  }
}
