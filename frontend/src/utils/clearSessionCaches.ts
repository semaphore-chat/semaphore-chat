import type { QueryClient } from "@tanstack/react-query";
import { abortAllAttachmentSends } from "./attachmentSend";

/**
 * Drop everything the TanStack Query client holds about the signed-out
 * account (profile, communities, DMs, unread counts, cached messages), so the
 * next account signed in on this tab never sees it, even briefly.
 *
 * Call it from every path that ends a session, after the socket is
 * disconnected and the tokens are cleared, and before navigating to the login
 * page. In-flight queries are cancelled first so a late response can't
 * repopulate the cache. Pending attachment uploads are aborted and dropped too.
 */
export function clearSessionCaches(queryClient: QueryClient): void {
  void queryClient.cancelQueries();
  queryClient.clear();
  // In-flight uploads and their pending tiles belong to the account too.
  abortAllAttachmentSends();
}
