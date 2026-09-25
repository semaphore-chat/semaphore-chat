/**
 * Subscribes to `semaphore://` deep links forwarded from the Electron main
 * process (see `electron/deep-link-parser.ts` + `electron/main.ts`) and
 * navigates the SPA to the matching in-app route.
 *
 * Mount seam: called unconditionally from the top of App.tsx — deliberately
 * NOT inside AuthGate or Layout. Both of those unmount whenever the user is
 * on a route outside their subtree, which includes `/login` and
 * `/join/:inviteCode` (a *public* route per App.tsx's route table) — i.e.
 * exactly the screens a deep link most needs to reach a user on before
 * they've signed in. App() itself is always mounted (it's the HashRouter's
 * direct child in main.tsx) for the life of the renderer, so this is the
 * one seam guaranteed to have a live `onDeepLink` listener regardless of
 * auth state or current route.
 *
 * "Auth is knowable" here doesn't come from local state — it comes from
 * `tokenService.isAuthenticated()` (in-memory access token presence) at the
 * moment a link arrives, plus a stash (`utils/deepLinkStash.ts`) for the
 * "not yet" case. AuthGate is the actual owner of "auth just completed" (it
 * is the one place every sign-in path funnels through), so it flushes the
 * stash once its state reaches Authenticated — see the effect in
 * AuthGate.tsx.
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useElectronAPI } from '../contexts/ElectronContext';
import { isAuthenticated } from '../utils/tokenService';
import { deepLinkRouteRequiresAuth, mapDeepLinkRouteToPath } from '../utils/deepLinkRoute';
import { stashDeepLinkRoute } from '../utils/deepLinkStash';
import type { DeepLinkRoute } from '../types/electron-api';
import { logger } from '../utils/logger';

export function useDeepLinks(): void {
  const navigate = useNavigate();
  const electronAPI = useElectronAPI();

  useEffect(() => {
    // Null outside Electron.
    const onDeepLink = electronAPI?.onDeepLink;
    if (!onDeepLink) return;

    const unsubscribe = onDeepLink((route: DeepLinkRoute) => {
      const path = mapDeepLinkRouteToPath(route);
      if (!path) {
        logger.dev('[useDeepLinks] ignoring unknown/invalid route:', route);
        return;
      }

      if (!deepLinkRouteRequiresAuth(route) || isAuthenticated()) {
        navigate(path);
        return;
      }

      // Not authenticated yet — stash (latest wins) for AuthGate to flush
      // once sign-in completes.
      stashDeepLinkRoute(route);
    });

    // Tell main this listener now exists, so any URL that arrived before
    // this mount (cold start, or a second-instance launch that raced
    // window/renderer startup) can be safely delivered. See the
    // 'deep-link:ready' handler in electron/main.ts for why this is an
    // explicit renderer->main signal rather than relying on
    // did-finish-load, which fires before this listener is attached.
    electronAPI.notifyDeepLinkReady?.();

    return unsubscribe;
  }, [electronAPI, navigate]);
}
