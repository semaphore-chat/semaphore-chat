import type { QueryClient } from "@tanstack/react-query";
import { abortAllAttachmentSends } from "./attachmentSend";

/**
 * Drop everything the TanStack Query client holds about the signed-out
 * account (profile, communities, DMs, unread counts, cached messages), so the
 * next account signed in on this tab never sees it, even briefly.
 *
 * Part of endLocalSession(); call that, not this, to end a session.
 * `clear()` removes every query, and removing a query cancels its in-flight
 * fetch silently (query-core 5.x: `QueryCache.remove` -> `Query.destroy` ->
 * `cancel({ silent: true })`), so a late response can't repopulate the cache
 * and imperative `fetchQuery` callers aren't rejected with CancelledError.
 * Pending attachment uploads are aborted and dropped too.
 */
export function clearSessionCaches(queryClient: QueryClient): void {
  queryClient.clear();
  // In-flight uploads and their pending tiles belong to the account too.
  abortAllAttachmentSends();
}

/**
 * After the signed-in screens have unmounted: drop every query no mounted
 * component observes. A signed-in screen that re-rendered between the
 * sign-out's clear() and its unmount rebuilt its query (and may have fired a
 * token-less fetch); this removes it, and cancels that fetch. Queries the
 * now-mounted screens (the login page's public settings) observe are kept.
 */
export function removeUnobservedQueries(queryClient: QueryClient): void {
  const cache = queryClient.getQueryCache();
  for (const query of cache.getAll()) {
    if (query.getObserversCount() === 0) cache.remove(query);
  }
  queryClient.getMutationCache().clear();
}
